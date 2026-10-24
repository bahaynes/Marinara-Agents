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

  async function fetchDecisionStatus() {
    try {
      const res = await fetch("/api/decision/options");
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  class NarrativeArchitectSettingsElement extends HTMLElement {
    constructor() {
      super();
      this.state = {
        loading: true,
        saving: false,
        savedMessage: "",
        decisionOptions: null,
        settings: {
          connectionId: "",
          useDecisionModel: false,
          decisionConnectionId: "system",
          fallbackInterval: 5,
        },
      };
      this._lastLoadedChatId = null;
      this._rendered = false;
    }

    get chatId() {
      return this.capabilityProps?.chatId;
    }

    get connections() {
      const list = Array.isArray(this.capabilityProps?.connections)
        ? this.capabilityProps.connections
        : [];
      return list.filter(
        (c) => c.provider !== "image_generation" && c.provider !== "video_generation"
      );
    }

    connectedCallback() {
      this._onProps = () => {
        if (this.chatId && this._lastLoadedChatId !== this.chatId) {
          this._lastLoadedChatId = this.chatId;
          void this.load();
        } else {
          this.updateDOM();
        }
      };
      this.addEventListener("marinara-capability-props", this._onProps);

      if (this.chatId) {
        this._lastLoadedChatId = this.chatId;
        void this.load();
      } else {
        this.renderOnce();
      }
    }

    disconnectedCallback() {
      if (this._onProps) {
        this.removeEventListener("marinara-capability-props", this._onProps);
      }
    }

    async load() {
      this.state.loading = true;
      const [settingsData, decisionData] = await Promise.all([
        (async () => {
          try {
            return await api(`/settings/${encodeURIComponent(this.chatId)}`);
          } catch {
            return null;
          }
        })(),
        fetchDecisionStatus(),
      ]);

      if (settingsData) {
        this.state.settings = {
          connectionId: settingsData.connectionId ?? "",
          useDecisionModel: Boolean(settingsData.useDecisionModel),
          decisionConnectionId: settingsData.decisionConnectionId ?? "system",
          fallbackInterval: settingsData.fallbackInterval ?? 5,
        };
      }
      this.state.decisionOptions = decisionData;
      this.state.loading = false;

      this.renderOnce();
      this.updateDOM();
    }

    async update(patch) {
      this.state.settings = { ...this.state.settings, ...patch };
      this.state.saving = true;
      this.setSavedMessage("Saving...");
      this.updateDOM();

      if (!this.chatId) return;
      try {
        await api(`/settings/${encodeURIComponent(this.chatId)}`, "PATCH", this.state.settings);
        this.state.saving = false;
        this.setSavedMessage("Saved");
        setTimeout(() => {
          if (this.state.savedMessage === "Saved") {
            this.setSavedMessage("");
          }
        }, 2000);
      } catch (err) {
        console.error("[narrative-architect] Failed to save settings:", err);
        this.state.saving = false;
        this.setSavedMessage("Error saving");
      }
    }

    setSavedMessage(msg) {
      this.state.savedMessage = msg;
      const el = this.querySelector('[data-ref="savedMessage"]');
      if (el) el.textContent = msg;
    }

    renderOnce() {
      if (this._rendered) return;
      this._rendered = true;

      this.innerHTML = `
        <div class="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--card)]/40 p-3 text-xs">
          <!-- Header with status -->
          <div class="flex items-center justify-between border-b border-[var(--border)]/40 pb-2">
            <div>
              <span class="text-xs font-semibold text-[var(--foreground)]">Narrative Architecture Pass</span>
              <p class="text-[0.625rem] text-[var(--muted-foreground)]">Pre-generation scene beats, subtext, and turning points</p>
            </div>
            <span data-ref="savedMessage" class="text-[0.625rem] font-medium text-[var(--primary)]"></span>
          </div>

          <!-- Thinking Model Connection -->
          <div class="space-y-1">
            <label class="text-[0.6875rem] font-medium text-[var(--foreground)] flex items-center justify-between">
              <span>Thinking Model Connection</span>
            </label>
            <select data-field="connectionId" class="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]">
            </select>
            <p class="text-[0.59375rem] text-[var(--muted-foreground)]">
              Model invoked to build the scene's logical skeleton (e.g. z-ai/glm-5.3:thinking, DeepSeek R1).
            </p>
          </div>

          <!-- Decision Model Gating Section -->
          <div class="space-y-2 pt-1 border-t border-[var(--border)]/40">
            <div class="flex items-center justify-between">
              <div>
                <label class="text-[0.6875rem] font-medium text-[var(--foreground)] block">Decision Model Gating</label>
                <span data-ref="decisionStatusBadge" class="inline-flex items-center gap-1 text-[0.59375rem] text-[var(--muted-foreground)] mt-0.5">
                  Checking status...
                </span>
              </div>
              <button
                type="button"
                role="switch"
                data-ref="decisionToggle"
                aria-checked="false"
                class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-[var(--muted)]"
              >
                <span
                  data-ref="decisionToggleKnob"
                  class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0"
                ></span>
              </button>
            </div>

            <!-- Decision Model Connection Dropdown (shown when toggle is ON) -->
            <div data-ref="decisionConnectionSection" class="space-y-1 pl-2 border-l-2 border-[var(--primary)]/30 mt-2">
              <label class="text-[0.625rem] font-medium text-[var(--foreground)] block">
                Decision Connection
              </label>
              <select data-field="decisionConnectionId" class="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2.5 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]">
              </select>
              <p class="text-[0.59375rem] text-[var(--muted-foreground)]">
                Evaluates each turn with zero/minimal token cost; only triggers the thinking model when a scene break or location change occurs.
              </p>
            </div>

            <div data-ref="decisionFallbackNotice" class="rounded bg-[var(--muted)]/20 px-2 py-1 text-[0.59375rem] text-[var(--muted-foreground)]">
              Decision model gating is disabled. Gating defaults to the turn cadence below.
            </div>
          </div>

          <!-- Fallback Cadence -->
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
                  data-field="fallbackInterval"
                  class="w-16 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-center text-xs text-[var(--foreground)] outline-none focus:border-[var(--ring)] focus:ring-1 focus:ring-[var(--ring)]"
                />
                <span class="text-[0.625rem] text-[var(--muted-foreground)]">turns</span>
              </div>
            </div>
            <p class="text-[0.59375rem] text-[var(--muted-foreground)]">
              Refreshes the beat sheet every N messages or whenever an explicit divider (***) appears.
            </p>
          </div>
        </div>
      `;

      // Event listener: Thinking connection
      const thinkSelect = this.querySelector('select[data-field="connectionId"]');
      if (thinkSelect) {
        thinkSelect.addEventListener("change", (e) => {
          this.update({ connectionId: e.target.value });
        });
      }

      // Event listener: Decision toggle button
      const toggleBtn = this.querySelector('[data-ref="decisionToggle"]');
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          const nextVal = !this.state.settings.useDecisionModel;
          this.update({ useDecisionModel: nextVal });
        });
      }

      // Event listener: Decision connection
      const decisionSelect = this.querySelector('select[data-field="decisionConnectionId"]');
      if (decisionSelect) {
        decisionSelect.addEventListener("change", (e) => {
          this.update({ decisionConnectionId: e.target.value });
        });
      }

      // Event listener: Fallback cadence
      const cadenceInput = this.querySelector('input[data-field="fallbackInterval"]');
      if (cadenceInput) {
        cadenceInput.addEventListener("change", (e) => {
          const val = Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 5));
          this.update({ fallbackInterval: val });
        });
      }
    }

    updateDOM() {
      if (!this._rendered) return;

      const { connectionId, useDecisionModel, decisionConnectionId, fallbackInterval } = this.state.settings;
      const connections = this.connections;
      const activeEl = document.activeElement;

      // 1. Update Thinking Model options
      const thinkSelect = this.querySelector('select[data-field="connectionId"]');
      if (thinkSelect && activeEl !== thinkSelect) {
        const desiredOptions = [
          `<option value="" ${!connectionId ? "selected" : ""}>Default Agent Connection (or chat model)</option>`,
          ...connections.map((c) => {
            const selected = c.id === connectionId ? "selected" : "";
            const label = c.name + (c.model ? ` (${c.model})` : "");
            return `<option value="${escapeHtml(c.id)}" ${selected}>${escapeHtml(label)}</option>`;
          }),
        ].join("");
        if (thinkSelect.innerHTML !== desiredOptions) {
          thinkSelect.innerHTML = desiredOptions;
        }
      }

      // 2. Update Decision Model status badge
      const badge = this.querySelector('[data-ref="decisionStatusBadge"]');
      if (badge) {
        const decData = this.state.decisionOptions;
        const selectedId = decData?.selected;
        const selectedOpt = decData?.options?.find((o) => o.id === selectedId || o.selected);
        if (selectedOpt) {
          badge.innerHTML = `<span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span> System Model: ${escapeHtml(selectedOpt.label || "Active")}`;
        } else if (selectedId) {
          badge.innerHTML = `<span class="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"></span> System Model: Active`;
        } else {
          badge.innerHTML = `<span class="inline-block h-1.5 w-1.5 rounded-full bg-[var(--muted-foreground)]"></span> System Model: Not configured`;
        }
      }

      // 3. Update Toggle state
      const toggleBtn = this.querySelector('[data-ref="decisionToggle"]');
      const toggleKnob = this.querySelector('[data-ref="decisionToggleKnob"]');
      const decisionSection = this.querySelector('[data-ref="decisionConnectionSection"]');
      const fallbackNotice = this.querySelector('[data-ref="decisionFallbackNotice"]');

      if (toggleBtn && toggleKnob) {
        toggleBtn.setAttribute("aria-checked", String(useDecisionModel));
        if (useDecisionModel) {
          toggleBtn.className = "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-[var(--primary)]";
          toggleKnob.className = "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-4";
          if (decisionSection) decisionSection.style.display = "block";
          if (fallbackNotice) fallbackNotice.style.display = "none";
        } else {
          toggleBtn.className = "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none bg-[var(--muted)]";
          toggleKnob.className = "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0";
          if (decisionSection) decisionSection.style.display = "none";
          if (fallbackNotice) fallbackNotice.style.display = "block";
        }
      }

      // 4. Update Decision Connection options
      const decSelect = this.querySelector('select[data-field="decisionConnectionId"]');
      if (decSelect && activeEl !== decSelect) {
        const decData = this.state.decisionOptions;
        const selectedOpt = decData?.options?.find((o) => o.id === decData?.selected || o.selected);
        const systemLabel = selectedOpt ? `System Decision Model (${selectedOpt.label})` : "System Decision Model (Default)";

        const desiredDecisionOptions = [
          `<option value="system" ${decisionConnectionId === "system" || !decisionConnectionId ? "selected" : ""}>${escapeHtml(systemLabel)}</option>`,
          ...connections.map((c) => {
            const selected = c.id === decisionConnectionId ? "selected" : "";
            const label = c.name + (c.model ? ` (${c.model})` : "");
            return `<option value="${escapeHtml(c.id)}" ${selected}>${escapeHtml(label)}</option>`;
          }),
        ].join("");
        if (decSelect.innerHTML !== desiredDecisionOptions) {
          decSelect.innerHTML = desiredDecisionOptions;
        }
      }

      // 5. Update Fallback Cadence input
      const cadenceInput = this.querySelector('input[data-field="fallbackInterval"]');
      if (cadenceInput && activeEl !== cadenceInput) {
        cadenceInput.value = Number(fallbackInterval) || 5;
      }
    }
  }

  if (typeof customElements !== "undefined" && !customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, NarrativeArchitectSettingsElement);
  }
})();
