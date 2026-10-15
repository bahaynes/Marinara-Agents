"use strict";

// Call Sheet's Tracker Panel section: the current scene plan, Next scene, and the review step
// (edit, reroll, accept) for the proposed scene.
(() => {
  const TAG_NAME = "marinara-capability-call-sheet";
  const API = "/api/call-sheet/v1/chats";
  const FIELDS = [
    ["title", "Title", "input"],
    ["location", "Location", "input"],
    ["cast", "Present (one per line)", "list"],
    ["goals", "What this scene is for (one per line)", "list"],
    ["facts", "Facts in play (one per line)", "list"],
    ["opening", "Opening", "text"],
  ];

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  async function call(path, method = "GET", body) {
    const response = await fetch(`${API}/${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  const STYLE = `
    :host { display: block; font: inherit; color: inherit; }
    .cs { display: grid; gap: 8px; padding: 8px 10px; font-size: 13px; }
    h3 { margin: 0; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; gap: 8px; }
    h4 { margin: 4px 0 0; font-size: 12px; font-weight: 600; opacity: 0.8; }
    ul { margin: 0; padding-left: 18px; }
    p { margin: 0; }
    .muted { opacity: 0.65; font-size: 12px; }
    .error { color: #fb7185; font-size: 12px; }
    .row { display: flex; flex-wrap: wrap; gap: 6px; }
    label { display: grid; gap: 2px; font-size: 12px; }
    input, textarea { font: inherit; color: inherit; background: color-mix(in srgb, currentColor 6%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 25%, transparent); border-radius: 6px; padding: 4px 6px; }
    textarea { resize: vertical; min-height: 44px; }
    button { font: inherit; font-size: 12px; color: inherit; cursor: pointer; border-radius: 6px; padding: 4px 10px;
      background: color-mix(in srgb, currentColor 10%, transparent); border: 1px solid color-mix(in srgb, currentColor 30%, transparent); }
    button.primary { background: color-mix(in srgb, #34d399 30%, transparent); }
    button:disabled { opacity: 0.5; cursor: default; }
    details summary { cursor: pointer; font-size: 12px; opacity: 0.8; }
    .goal-met { color: #34d399; } .goal-failed { color: #fb7185; }
  `;

  class CallSheetElement extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._props = null;
      this._chatId = null;
      this._sheet = null;
      this._busy = "";
      this._error = "";
      this._draftIndex = -1;
      this._token = 0;
      this.onCapabilityProps = () => this.sync();
    }

    set capabilityProps(value) {
      this._props = value;
      if (this.isConnected) this.sync();
    }

    get capabilityProps() {
      return this._props;
    }

    connectedCallback() {
      this.addEventListener("marinara-capability-props", this.onCapabilityProps);
      this.sync();
    }

    disconnectedCallback() {
      this.removeEventListener("marinara-capability-props", this.onCapabilityProps);
      this._token += 1;
    }

    sync() {
      const chatId = typeof this._props?.chatId === "string" ? this._props.chatId : null;
      if (chatId === this._chatId) return;
      this._chatId = chatId;
      this._sheet = null;
      this._error = "";
      this.render();
      if (chatId) this.run("", () => call(encodeURIComponent(chatId)));
    }

    /** Run one request; the panel shows `label` while it is in flight and ignores answers for an old chat. */
    async run(label, work) {
      const token = ++this._token;
      const chatId = this._chatId;
      this._busy = label;
      this._error = "";
      this.render();
      try {
        const sheet = await work();
        if (token !== this._token || chatId !== this._chatId) return;
        if (sheet && Array.isArray(sheet.scenes)) this._sheet = sheet;
      } catch (error) {
        if (token === this._token) this._error = error.message;
      }
      if (token === this._token) {
        this._busy = "";
        this._draftIndex = this._sheet?.proposal ? this._sheet.proposal.plans.length - 1 : -1;
        this.render();
      }
    }

    path(suffix) {
      return `${encodeURIComponent(this._chatId)}${suffix}`;
    }

    openScene() {
      const scenes = this._sheet?.scenes ?? [];
      const last = scenes[scenes.length - 1];
      return last && last.summary === null ? last : null;
    }

    readPlan() {
      const root = this.shadowRoot;
      const plan = {};
      for (const [key, , kind] of FIELDS) {
        const value = root.querySelector(`[data-field="${key}"]`)?.value ?? "";
        plan[key] =
          kind === "list"
            ? value
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
            : value.trim();
      }
      return plan;
    }

    async nextScene() {
      const instruction = this.shadowRoot.querySelector("[data-instruction]")?.value ?? "";
      await this.run("Summarizing the scene…", async () => {
        if (this.openScene()) await call(this.path("/end"), "POST", {});
        this._busy = "Planning the next scene…";
        this.render();
        return call(this.path("/propose"), "POST", { instruction });
      });
    }

    async reroll() {
      const instruction = this._sheet?.proposal?.instruction ?? "";
      await this.run("Planning another version…", () => call(this.path("/propose"), "POST", { instruction }));
    }

    async accept() {
      const plan = this.readPlan();
      await this.run("Starting the scene…", async () => {
        const { sheet, hideMessageIds } = await call(this.path("/accept"), "POST", { plan });
        // Finished scenes leave the prompt; their frozen summaries stand in for them. They stay visible.
        if (hideMessageIds.length) {
          const response = await fetch(`/api/chats/${encodeURIComponent(this._chatId)}/messages/bulk-hidden`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageIds: hideMessageIds, hidden: true }),
          });
          if (!response.ok) throw new Error("The scene started, but earlier messages could not be hidden from the AI.");
        }
        return sheet;
      });
    }

    async saveSpine() {
      const root = this.shadowRoot;
      const spine = {
        premise: root.querySelector("[data-spine=premise]")?.value ?? "",
        goals: root.querySelector("[data-spine=goals]")?.value ?? "",
      };
      await this.run("Saving…", () => call(this.path("/spine"), "PUT", spine));
    }

    renderPlan(plan) {
      const list = (items) =>
        items?.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
      return `
        ${plan.location ? `<p><b>Where:</b> ${escapeHtml(plan.location)}</p>` : ""}
        ${plan.cast?.length ? `<h4>Present</h4>${list(plan.cast)}` : ""}
        ${plan.goals?.length ? `<h4>For</h4>${list(plan.goals)}` : ""}
        ${plan.facts?.length ? `<h4>Facts</h4>${list(plan.facts)}` : ""}
        ${plan.opening ? `<p class="muted">${escapeHtml(plan.opening)}</p>` : ""}`;
    }

    renderReview(proposal) {
      const plans = proposal.plans;
      const plan = plans[Math.max(0, Math.min(this._draftIndex, plans.length - 1))];
      const field = ([key, label, kind]) => {
        const value = kind === "list" ? (plan[key] ?? []).join("\n") : (plan[key] ?? "");
        return kind === "input"
          ? `<label>${label}<input data-field="${key}" value="${escapeHtml(value)}"></label>`
          : `<label>${label}<textarea data-field="${key}" rows="${kind === "list" ? 3 : 2}">${escapeHtml(value)}</textarea></label>`;
      };
      const versions =
        plans.length > 1
          ? `<div class="row">${plans
              .map(
                (_, i) => `<button data-version="${i}" ${i === this._draftIndex ? "disabled" : ""}>v${i + 1}</button>`,
              )
              .join("")}</div>`
          : "";
      return `
        <h3>Proposed scene</h3>
        ${proposal.instruction ? `<p class="muted">From: ${escapeHtml(proposal.instruction)}</p>` : ""}
        ${versions}
        ${FIELDS.map(field).join("")}
        <div class="row">
          <button class="primary" data-action="accept">Accept</button>
          <button data-action="reroll">Reroll</button>
          <button data-action="discard">Discard</button>
        </div>`;
    }

    render() {
      const sheet = this._sheet;
      let body;
      if (!this._chatId) body = `<p class="muted">Open a Roleplay chat.</p>`;
      else if (!sheet) body = `<p class="muted">Loading…</p>`;
      else if (sheet.proposal) body = this.renderReview(sheet.proposal);
      else {
        const scene = this.openScene();
        const done = sheet.scenes.filter((s) => s.summary !== null);
        const last = done[done.length - 1];
        body = `
          ${
            scene
              ? `<h3><span>Scene ${sheet.scenes.length}: ${escapeHtml(scene.plan.title)}</span></h3>${this.renderPlan(scene.plan)}`
              : `<p class="muted">${sheet.scenes.length ? "Between scenes." : "No scene yet. Describe the first one, or leave it empty and let the model pick."}</p>`
          }
          <label>${scene ? "Next scene" : "First scene"} (optional direction)
            <textarea data-instruction rows="2" placeholder="A few hours later, everyone meets to debrief…"></textarea></label>
          <div class="row"><button class="primary" data-action="next">${scene ? "End scene & plan next" : "Plan scene"}</button></div>
          ${
            last
              ? `<details><summary>Last scene: ${escapeHtml(last.plan.title)}</summary><p>${escapeHtml(last.summary)}</p>${
                  last.outcomes?.length
                    ? `<ul>${last.outcomes.map((o) => `<li class="goal-${o.status}">${escapeHtml(o.goal)} — ${o.status}</li>`).join("")}</ul>`
                    : ""
                }</details>`
              : ""
          }
          <details><summary>Story</summary>
            <label>Premise<textarea data-spine="premise" rows="3">${escapeHtml(sheet.spine.premise)}</textarea></label>
            <label>Story goals<textarea data-spine="goals" rows="2">${escapeHtml(sheet.spine.goals)}</textarea></label>
            <div class="row"><button data-action="spine">Save story</button></div>
          </details>`;
      }
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="cs">
        ${body}
        ${this._busy ? `<p class="muted">${escapeHtml(this._busy)}</p>` : ""}
        ${this._error ? `<p class="error">${escapeHtml(this._error)}</p>` : ""}
      </div>`;
      for (const button of this.shadowRoot.querySelectorAll("button")) {
        if (this._busy) button.disabled = true;
        button.addEventListener("click", () => this.onClick(button));
      }
    }

    onClick(button) {
      if (button.dataset.version !== undefined) {
        this._draftIndex = Number(button.dataset.version);
        this.render();
        return;
      }
      const action = button.dataset.action;
      if (action === "next") void this.nextScene();
      else if (action === "reroll") void this.reroll();
      else if (action === "accept") void this.accept();
      else if (action === "spine") void this.saveSpine();
      else if (action === "discard") void this.run("", () => call(this.path("/proposal"), "DELETE"));
    }
  }

  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, CallSheetElement);
})();
