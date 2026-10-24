"use strict";

(() => {
  const TAG_NAME = "marinara-capability-narrative-architect";
  const API_ROOT = "/api/narrative-architect";

  const escapeHtml = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  async function api(path, method = "GET", body) {
    const headers = { "Content-Type": "application/json" };
    if (method !== "GET") headers["x-marinara-csrf"] = "1";
    const res = await fetch(`${API_ROOT}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`API error ${res.status}`);
    return res.json();
  }

  class NarrativeArchitectSettingsElement extends HTMLElement {
    constructor() {
      super();
      this.state = {
        loading: false,
        saving: false,
        savedMessage: "",
        settings: {
          connectionId: "",
          fallbackInterval: 5,
        },
      };
      this._lastLoadedChatId = null;
    }

    get chatId() {
      return this.capabilityProps?.chatId;
    }

    get connections() {
      return Array.isArray(this.capabilityProps?.connections)
        ? this.capabilityProps.connections
        : [];
    }

    connectedCallback() {
      this._onProps = () => {
        if (this.chatId && this._lastLoadedChatId !== this.chatId) {
          this._lastLoadedChatId = this.chatId;
          void this.load();
        } else {
          this.render();
        }
      };
      this.addEventListener("marinara-capability-props", this._onProps);

      if (this.chatId) {
        this._lastLoadedChatId = this.chatId;
        void this.load();
      } else {
        this.render();
      }
    }

    disconnectedCallback() {
      if (this._onProps) {
        this.removeEventListener("marinara-capability-props", this._onProps);
      }
    }

    async load() {
      if (!this.chatId) return;
      this.state.loading = true;
      this.render();
      try {
        const data = await api(`/settings/${encodeURIComponent(this.chatId)}`);
        if (data) {
          this.state.settings = {
            connectionId: data.connectionId ?? "",
            fallbackInterval: data.fallbackInterval ?? 5,
          };
        }
      } catch {
        // Fallback to current state
      } finally {
        this.state.loading = false;
        this.render();
      }
    }

    async update(patch) {
      this.state.settings = { ...this.state.settings, ...patch };
      this.state.saving = true;
      this.state.savedMessage = "Saving...";
      this.render();
      if (!this.chatId) return;
      try {
        await api(`/settings/${encodeURIComponent(this.chatId)}`, "PATCH", this.state.settings);
        this.state.saving = false;
        this.state.savedMessage = "Saved";
        this.render();
        setTimeout(() => {
          if (this.state.savedMessage === "Saved") {
            this.state.savedMessage = "";
            this.render();
          }
        }, 2000);
      } catch (err) {
        console.error("[narrative-architect] Failed to save settings:", err);
        this.state.saving = false;
        this.state.savedMessage = "Error saving";
        this.render();
      }
    }

    render() {
      if (this.state.loading) {
        this.innerHTML = `<div class="mt-2 py-1 text-[0.625rem] text-[var(--muted-foreground)]">Loading Narrative Architect settings...</div>`;
        return;
      }

      const { connectionId, fallbackInterval } = this.state.settings;

      const connectionOptions = [
        `<option value="" ${!connectionId ? "selected" : ""}>Default Agent Connection (or chat model)</option>`,
        ...this.connections.map((c) => {
          const selected = c.id === connectionId ? "selected" : "";
          const label = c.name + (c.model ? ` (${c.model})` : "");
          return `<option value="${escapeHtml(c.id)}" ${selected}>${escapeHtml(label)}</option>`;
        }),
      ].join("");

      this.innerHTML = `
        <div class="mt-2.5 space-y-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)]/50 p-2.5 text-xs">
          <div class="space-y-1">
            <div class="flex items-center justify-between">
              <label class="text-[0.6875rem] font-medium text-[var(--foreground)]">
                Thinking Model Connection
              </label>
              ${this.state.savedMessage ? `<span class="text-[0.625rem] text-[var(--muted-foreground)]">${escapeHtml(this.state.savedMessage)}</span>` : ""}
            </div>
            <select data-field="connectionId" class="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]">
              ${connectionOptions}
            </select>
            <p class="text-[0.625rem] text-[var(--muted-foreground)]">
              Select the connection used for scene architecture (e.g. z-ai/glm-5.3:thinking, DeepSeek R1).
            </p>
          </div>

          <div class="space-y-1 pt-1 border-t border-[var(--border)]/40">
            <div class="flex items-center justify-between">
              <label class="text-[0.6875rem] font-medium text-[var(--foreground)]">
                Fallback Cadence
              </label>
              <div class="flex items-center gap-1.5">
                <input
                  type="number"
                  min="1"
                  max="50"
                  value="${Number(fallbackInterval) || 5}"
                  data-field="fallbackInterval"
                  class="w-16 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-center text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
                />
                <span class="text-[0.625rem] text-[var(--muted-foreground)]">turns</span>
              </div>
            </div>
            <p class="text-[0.625rem] text-[var(--muted-foreground)]">
              Used when no Decision Model is configured. Triggers a new scene beat pass every N messages.
            </p>
          </div>

          <div class="rounded bg-[var(--muted)]/20 px-2 py-1.5 text-[0.625rem] text-[var(--muted-foreground)] flex items-start gap-1">
            <span class="font-medium text-[var(--foreground)] shrink-0">Decision Gating:</span>
            <span>If a Decision Model is set in Settings &rarr; Connections, it detects scene breaks with zero cloud token cost.</span>
          </div>
        </div>
      `;

      const select = this.querySelector('select[data-field="connectionId"]');
      if (select) {
        select.addEventListener("change", (e) => {
          this.update({ connectionId: e.target.value });
        });
      }

      const input = this.querySelector('input[data-field="fallbackInterval"]');
      if (input) {
        input.addEventListener("change", (e) => {
          const val = Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 5));
          this.update({ fallbackInterval: val });
        });
      }
    }
  }

  if (typeof customElements !== "undefined" && !customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, NarrativeArchitectSettingsElement);
  }
})();
