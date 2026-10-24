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
        loading: true,
        settings: {
          connectionId: "",
          fallbackInterval: 5,
        },
      };
    }

    connectedCallback() {
      this.load();
    }

    get chatId() {
      return this.capabilityProps?.chatId;
    }

    get connections() {
      return Array.isArray(this.capabilityProps?.connections)
        ? this.capabilityProps.connections
        : [];
    }

    async load() {
      if (!this.chatId) return;
      this.state.loading = true;
      this.render();
      try {
        const data = await api(`/settings/${encodeURIComponent(this.chatId)}`);
        this.state.settings = {
          connectionId: data.connectionId ?? "",
          fallbackInterval: data.fallbackInterval ?? 5,
        };
      } catch {
        // Use defaults if first time
      } finally {
        this.state.loading = false;
        this.render();
      }
    }

    async update(patch) {
      this.state.settings = { ...this.state.settings, ...patch };
      this.render();
      if (!this.chatId) return;
      try {
        await api(`/settings/${encodeURIComponent(this.chatId)}`, "PATCH", this.state.settings);
      } catch (err) {
        console.error("[narrative-architect] Failed to save settings:", err);
      }
    }

    render() {
      if (this.state.loading) {
        this.innerHTML = `<div class="py-2 text-[0.625rem] text-[var(--muted-foreground)]">Loading Narrative Architect settings...</div>`;
        return;
      }

      const { connectionId, fallbackInterval } = this.state.settings;

      const connectionOptions = [
        `<option value="" ${!connectionId ? "selected" : ""}>Default Agent Model Connection</option>`,
        ...this.connections.map((c) => {
          const selected = c.id === connectionId ? "selected" : "";
          const label = c.name + (c.model ? ` (${c.model})` : "");
          return `<option value="${escapeHtml(c.id)}" ${selected}>${escapeHtml(label)}</option>`;
        }),
      ].join("");

      this.innerHTML = `
        <div class="mt-2 space-y-3 rounded-lg bg-[var(--background)]/45 p-3 ring-1 ring-[var(--border)] text-xs">
          <div class="space-y-1">
            <label class="block text-[0.6875rem] font-medium text-[var(--foreground)]">
              Thinking Model Connection (Narrative Architect)
            </label>
            <select data-field="connectionId" class="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]">
              ${connectionOptions}
            </select>
            <p class="text-[0.625rem] text-[var(--muted-foreground)]">
              Select the model connection used for structural beat generation (e.g. z-ai/glm-5.3:thinking, DeepSeek R1).
            </p>
          </div>

          <div class="space-y-1">
            <label class="block text-[0.6875rem] font-medium text-[var(--foreground)]">
              Fallback Cadence (Messages)
            </label>
            <div class="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="50"
                value="${Number(fallbackInterval) || 5}"
                data-field="fallbackInterval"
                class="w-20 rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
              />
              <span class="text-[0.625rem] text-[var(--muted-foreground)]">messages between passes</span>
            </div>
            <p class="text-[0.625rem] text-[var(--muted-foreground)]">
              If your configured Decision Model is not detected or gives no response, refreshes the scene beat sheet every N messages.
            </p>
          </div>

          <div class="rounded bg-[var(--muted)]/30 p-2 text-[0.625rem] text-[var(--muted-foreground)] flex items-start gap-1.5">
            <span class="font-semibold text-[var(--foreground)]">Decision Gating:</span>
            <span>When a Decision Model is configured in Settings, it evaluates scene breaks turn-by-turn with zero cloud token cost.</span>
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

  if (!customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, NarrativeArchitectSettingsElement);
  }
})();
