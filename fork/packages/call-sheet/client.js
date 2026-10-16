"use strict";

// Call Sheet's Home page: the story list, and for one story the transcript, the input bar and the scene
// panel (current plan, Next scene, and the review step for a proposed scene).
(() => {
  const TAG_NAME = "marinara-capability-call-sheet";
  const API = "/api/call-sheet/v1";
  const PLAN_FIELDS = [
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

  /** Paragraphs, with quoted dialogue marked, *italics* and **bold**, after escaping. */
  const prose = (value) =>
    escapeHtml(value)
      .split(/\n{2,}/u)
      .map(
        (para) =>
          `<p>${para
            .replace(/(&quot;[^<]*?&quot;|“[^”<]*”)/gu, '<span class="say">$1</span>')
            .replace(/\*\*([^*\n]+)\*\*/gu, "<b>$1</b>")
            .replace(/\*([^*\n]+)\*/gu, "<i>$1</i>")
            .replaceAll("\n", "<br>")}</p>`,
      )
      .join("");

  async function call(path, method = "GET", body) {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  /**
   * POST a turn route as a server-sent event stream: `onEvent` sees each start/token event; the route's
   * result is returned. An Engine that cannot stream sends only the final event.
   */
  async function callStream(path, body, onEvent) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/^data: /u, "");
        buffer = buffer.slice(end + 2);
        const event = JSON.parse(line);
        if (event.type === "done") return event.result;
        if (event.type === "error") throw new Error(event.error);
        onEvent(event);
      }
    }
    throw new Error("The connection closed before the reply finished.");
  }

  // Display choices are per browser: they change how the page looks, never what the story sends.
  const DISPLAY_KEY = "marinara.call-sheet.display";
  const DISPLAY_DEFAULTS = Object.freeze({ size: "m", dialogue: true, boxes: true, width: "narrow" });

  function loadDisplay() {
    try {
      return { ...DISPLAY_DEFAULTS, ...JSON.parse(globalThis.localStorage?.getItem(DISPLAY_KEY) || "{}") };
    } catch {
      return { ...DISPLAY_DEFAULTS };
    }
  }

  function saveDisplay(display) {
    try {
      globalThis.localStorage?.setItem(DISPLAY_KEY, JSON.stringify(display));
    } catch {
      // Blocked storage: the choice lasts for this page.
    }
  }

  const NON_TEXT_PROVIDERS = new Set(["image_generation", "video_generation", "audio_generation", "decision"]);

  /** The Engine's text-model connections, for the story model picker. */
  async function textConnections() {
    const response = await fetch("/api/connections");
    if (!response.ok) return [];
    const list = await response.json().catch(() => []);
    return (Array.isArray(list) ? list : [])
      .filter((c) => !NON_TEXT_PROVIDERS.has(c.provider) && !c.embeddingModel)
      .map((c) => ({
        id: c.id,
        name: c.name,
        isDefault: c.isDefault === true || c.isDefault === "true",
        isAgentDefault: c.defaultForAgents === true || c.defaultForAgents === "true",
      }));
  }

  const STYLE = `
    :host { display: block; height: 100%; font: inherit; color: inherit; }
    * { box-sizing: border-box; }
    .page { height: 100%; display: flex; flex-direction: column; min-height: 0; position: relative;
      --text: 15.5px; --say: color-mix(in srgb, #f5b84b 80%, currentColor); --you: #60a5fa; }
    .size-s { --text: 14px; } .size-l { --text: 17.5px; }
    header { display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
    header h1 { margin: 0; font-size: 16px; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .body { flex: 1; min-height: 0; display: flex; }
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
    .side { width: 340px; flex-shrink: 0; overflow-y: auto; padding: 12px 14px;
      border-left: 1px solid color-mix(in srgb, currentColor 15%, transparent); display: grid; gap: 10px; align-content: start;
      font-size: 13px; }
    .scroll { flex: 1; overflow-y: auto; padding: 14px 18px; }
    .center { max-width: 720px; margin: 0 auto; display: grid; gap: 14px; }
    .wide .center { max-width: 1000px; }
    h2 { margin: 0; font-size: 14px; font-weight: 600; }
    h3 { margin: 0; font-size: 13px; font-weight: 600; }
    h4 { margin: 4px 0 0; font-size: 12px; font-weight: 600; opacity: 0.8; }
    p { margin: 0 0 0.6em; } p:last-child { margin-bottom: 0; }
    ul { margin: 0; padding-left: 18px; }
    .muted { opacity: 0.65; font-size: 12px; }
    .error { color: #fb7185; font-size: 12px; }
    .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    label { display: grid; gap: 3px; font-size: 12px; }
    input, textarea, select { font: inherit; font-size: 13px; color: inherit; width: 100%;
      background: color-mix(in srgb, currentColor 6%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 22%, transparent); border-radius: 8px; padding: 6px 8px; }
    textarea { resize: vertical; min-height: 44px; line-height: 1.4; }
    select option { color: #111; }
    button { font: inherit; font-size: 12px; color: inherit; cursor: pointer; border-radius: 8px; padding: 5px 12px;
      background: color-mix(in srgb, currentColor 9%, transparent); border: 1px solid color-mix(in srgb, currentColor 25%, transparent); }
    button:hover:not(:disabled) { background: color-mix(in srgb, currentColor 16%, transparent); }
    button.primary { background: color-mix(in srgb, #34d399 32%, transparent); border-color: color-mix(in srgb, #34d399 60%, transparent); }
    button.danger { color: #fb7185; }
    button.icon { padding: 2px 7px; font-size: 11px; }
    button:disabled { opacity: 0.45; cursor: default; }
    .card { border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; padding: 10px 12px;
      background: color-mix(in srgb, currentColor 3%, transparent); display: grid; gap: 6px; }
    .story-item { cursor: pointer; } .story-item:hover { background: color-mix(in srgb, currentColor 7%, transparent); }
    .cast-picker { max-height: 180px; overflow-y: auto; display: grid; gap: 2px; padding: 4px;
      border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 8px; }
    .cast-picker label { display: flex; gap: 6px; align-items: center; font-size: 13px; }
    .cast-picker input { width: auto; }
    .scene-head { text-align: center; padding: 18px 0 4px; display: grid; gap: 2px; }
    .scene-head h3 { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.85;
      display: flex; align-items: center; gap: 12px; }
    .scene-head h3::before, .scene-head h3::after { content: ""; flex: 1; height: 1px;
      background: color-mix(in srgb, currentColor 20%, transparent); }
    .turn { line-height: 1.75; font-size: var(--text); display: grid; gap: 6px; }
    .turn { position: relative; }
    .turn p { margin: 0 0 0.9em; } .turn p:last-child { margin-bottom: 0; }
    .turn .who { font-size: 12px; font-weight: 600; display: flex; gap: 8px; align-items: center; opacity: 0.85; }
    .avatar { width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 11px;
      background: color-mix(in srgb, currentColor 14%, transparent); }
    .turn.persona .avatar { background: color-mix(in srgb, var(--you) 40%, transparent); }
    .turn.persona { padding-left: 14px; border-left: 3px solid color-mix(in srgb, var(--you) 60%, transparent); }
    .boxes .turn { padding: 12px 16px; border-radius: 12px; background: color-mix(in srgb, currentColor 4%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 9%, transparent); }
    .boxes .turn.persona { background: color-mix(in srgb, var(--you) 9%, transparent);
      border-color: color-mix(in srgb, var(--you) 28%, transparent); border-left: 3px solid color-mix(in srgb, var(--you) 65%, transparent); }
    .dialogue .say { color: var(--say); }
    .overlay { position: absolute; inset: 0; z-index: 5; display: flex; justify-content: flex-end;
      background: color-mix(in srgb, #000 45%, transparent); }
    .drawer { width: min(440px, 100%); height: 100%; overflow-y: auto; padding: 14px 16px; display: grid; gap: 14px;
      align-content: start; background: var(--card, var(--background, #18181b)); font-size: 13px;
      border-left: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
    .drawer section { display: grid; gap: 8px; }
    .segmented { display: flex; gap: 4px; }
    .segmented button.on { background: color-mix(in srgb, #34d399 32%, transparent); border-color: color-mix(in srgb, #34d399 60%, transparent); }
    .check { display: flex; gap: 8px; align-items: center; font-size: 13px; }
    .check input { width: auto; }
    select.compact { width: auto; max-width: 220px; font-size: 12px; padding: 4px 6px; margin-left: auto; }
    .hint { font-size: 12px; opacity: 0.7; }
    .turn .tools { display: flex; gap: 4px; position: absolute; top: 8px; right: 10px; opacity: 0; transition: opacity 0.15s; }
    .turn:hover .tools, .turn:focus-within .tools { opacity: 1; }
    .instruction { font-size: 12px; opacity: 0.6; font-style: italic; }
    .frozen { opacity: 0.75; }
    .writing { opacity: 0.85; }
    .composer { border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent); padding: 10px 18px; }
    .composer .center { gap: 6px; }
    .goal-met { color: #34d399; } .goal-failed { color: #fb7185; }
    details summary { cursor: pointer; font-size: 12px; opacity: 0.85; }
    @media (max-width: 820px) {
      .body { flex-direction: column; overflow-y: auto; }
      .side { width: auto; border-left: none; border-top: 1px solid color-mix(in srgb, currentColor 15%, transparent); }
      .main { flex: none; height: calc(100% - 8px); min-height: 420px; }
      .scroll { padding: 12px 14px; }
      .turn .tools { opacity: 1; }
    }
  `;

  class CallSheetElement extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this.state = {
        view: "list",
        stories: null,
        library: null,
        storyId: null,
        data: null,
        busy: "",
        error: "",
        draftIndex: -1,
        editing: null,
        input: "",
        sceneInput: "",
        castFilter: "",
        writing: null,
        connections: [],
        display: loadDisplay(),
        settingsOpen: false,
      };
      this._props = null;
      this._token = 0;
      this.shadowRoot.addEventListener("click", (event) => this.onClick(event));
      this.shadowRoot.addEventListener("input", (event) => this.onInput(event));
      this.shadowRoot.addEventListener("change", (event) => this.onChange(event));
    }

    set capabilityProps(value) {
      this._props = value;
    }

    get capabilityProps() {
      return this._props;
    }

    connectedCallback() {
      this.render();
      void this.loadList();
    }

    disconnectedCallback() {
      this._token += 1;
    }

    set(patch) {
      Object.assign(this.state, patch);
      this.render();
    }

    /** Run one request; ignore its answer if the player has moved on. */
    async run(label, work) {
      const token = ++this._token;
      this.set({ busy: label, error: "" });
      try {
        await work();
      } catch (error) {
        if (token === this._token) this.state.error = error.message;
      }
      if (token === this._token) this.set({ busy: "" });
    }

    async loadList() {
      await this.run("", async () => {
        const [stories, library, connections] = await Promise.all([
          call("/stories"),
          this.state.library ?? call("/library"),
          this.state.connections.length ? this.state.connections : textConnections(),
        ]);
        this.state.stories = stories;
        this.state.library = library;
        this.state.connections = connections;
      });
    }

    async openStory(storyId) {
      this.set({ view: "story", storyId, data: null, editing: null, input: "", sceneInput: "" });
      await this.run("", async () => {
        this.state.data = await call(`/stories/${encodeURIComponent(storyId)}`);
        this.state.draftIndex = this.lastProposalIndex();
      });
      this.scrollToEnd();
    }

    lastProposalIndex() {
      const proposal = this.state.data?.story?.sheet?.proposal;
      return proposal ? proposal.plans.length - 1 : -1;
    }

    /** Apply a route's answer: a whole story, or one scene's turns. */
    apply(result) {
      if (!this.state.data) return;
      if (result?.sheet) {
        this.state.data.story = result;
        this.state.draftIndex = this.lastProposalIndex();
      } else if (result?.sceneId) {
        this.state.data.turns[result.sceneId] = result.turns;
        this.state.data.stats = { ...this.state.data.stats, [result.sceneId]: result.stats };
      }
    }

    storyPath(suffix = "") {
      return `/stories/${encodeURIComponent(this.state.storyId)}${suffix}`;
    }

    openScene() {
      const scenes = this.state.data?.story?.sheet?.scenes ?? [];
      const last = scenes[scenes.length - 1];
      return last && last.summary === null ? last : null;
    }

    personaName() {
      const id = this.state.data?.story?.personaId;
      return this.state.library?.personas.find((p) => p.id === id)?.name ?? "You";
    }

    scrollToEnd() {
      requestAnimationFrame(() => {
        const scroll = this.shadowRoot.querySelector(".main .scroll");
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
      });
    }

    // ── Actions ──

    async createStory() {
      const root = this.shadowRoot;
      const value = (name) => root.querySelector(`[name="${name}"]`)?.value ?? "";
      const characterIds = [...root.querySelectorAll("[name=cast]:checked")].map((box) => box.value);
      let created;
      await this.run("Creating…", async () => {
        created = await call("/stories", "POST", {
          title: value("title"),
          personaId: value("persona") || null,
          mainConnectionId: value("model") || null,
          characterIds,
          premise: value("premise"),
          goals: value("goals"),
        });
      });
      if (created) await this.openStory(created.id);
    }

    async play(kind) {
      const text = this.state.input.trim();
      if (kind !== "continue" && !text) return;
      const labels = {
        instruction: "Writing your turn, then the reply…",
        written: "Writing the reply…",
        continue: "Writing…",
      };
      await this.run(labels[kind], async () => {
        this.apply(await this.streamTurn(this.storyPath("/turns"), { kind, text }));
        this.state.input = "";
      });
      this.scrollToEnd();
    }

    /** Run a turn route, showing the reply as it is written. */
    async streamTurn(path, body) {
      try {
        return await callStream(path, body, (event) => {
          if (event.type === "start") {
            this.state.writing = { speaker: event.speaker, text: "" };
            this.render();
            this.scrollToEnd();
          } else if (event.type === "token" && this.state.writing) {
            this.state.writing.text += event.text;
            const node = this.shadowRoot.querySelector("[data-writing]");
            if (node) node.innerHTML = prose(this.state.writing.text);
            this.scrollToEnd();
          }
        });
      } finally {
        this.state.writing = null;
      }
    }

    async nextScene() {
      const instruction = this.state.sceneInput;
      await this.run("Summarizing the scene…", async () => {
        if (this.openScene()) this.apply(await call(this.storyPath("/end"), "POST", {}));
        this.set({ busy: "Planning the next scene…" });
        this.apply(await call(this.storyPath("/propose"), "POST", { instruction }));
        this.state.sceneInput = "";
      });
    }

    readPlan() {
      const plan = {};
      for (const [key, , kind] of PLAN_FIELDS) {
        const value = this.shadowRoot.querySelector(`[data-field="${key}"]`)?.value ?? "";
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

    async accept() {
      const plan = this.readPlan();
      await this.run("Starting the scene…", async () => {
        this.apply(await call(this.storyPath("/accept"), "POST", { plan }));
        this.state.data.turns[this.openScene().id] = [];
        this.set({ busy: "Writing the opening…" });
        this.apply(await this.streamTurn(this.storyPath("/turns"), { kind: "continue" }));
      });
      this.scrollToEnd();
    }

    async turnAction(action, turnId) {
      const path = this.storyPath(`/turns/${encodeURIComponent(turnId)}`);
      if (action === "reroll") {
        await this.run("Writing another version…", async () => this.apply(await this.streamTurn(`${path}/reroll`, {})));
      } else if (action === "delete") {
        if (!confirm("Delete this turn and everything after it?")) return;
        await this.run("", async () => this.apply(await call(path, "DELETE")));
      } else if (action === "edit") this.set({ editing: turnId });
      else if (action === "cancel-edit") this.set({ editing: null });
      else if (action === "save-edit") {
        const text = this.shadowRoot.querySelector("[data-edit]")?.value ?? "";
        await this.run("", async () => {
          this.apply(await call(path, "PUT", { text }));
          this.state.editing = null;
        });
      }
    }

    async saveSpine() {
      const root = this.shadowRoot;
      const spine = {
        premise: root.querySelector("[data-spine=premise]")?.value ?? "",
        goals: root.querySelector("[data-spine=goals]")?.value ?? "",
      };
      await this.run("Saving…", async () => this.apply(await call(this.storyPath("/spine"), "PUT", spine)));
    }

    async deleteStory() {
      if (!confirm("Delete this story for good?")) return;
      await this.run("Deleting…", async () => {
        await call(this.storyPath(), "DELETE");
        this.state.view = "list";
        this.state.data = null;
      });
      await this.loadList();
    }

    modelOptions(selected, agent = false) {
      const fallback = this.state.connections.find((c) => (agent ? c.isAgentDefault : c.isDefault))?.name;
      return [
        `<option value="">Default ${agent ? "agent" : "main"} connection${fallback ? ` (${escapeHtml(fallback)})` : ""}</option>`,
        ...this.state.connections.map(
          (c) =>
            `<option value="${escapeHtml(c.id)}" ${c.id === selected ? "selected" : ""}>${escapeHtml(c.name)}</option>`,
        ),
      ].join("");
    }

    /** Story settings save when a field changes; display choices apply at once and stay in this browser. */
    onChange(event) {
      const target = event.target;
      const key = target.dataset.set;
      if (key) {
        const value = target.type === "checkbox" ? target.checked : target.value || null;
        if (key === "title" && !value) return;
        void this.run("Saving…", async () =>
          this.apply(await call(this.storyPath("/settings"), "PUT", { [key]: value })),
        );
      } else if (target.dataset.display) {
        this.setDisplay(target.dataset.display, target.checked);
      }
    }

    setDisplay(key, value) {
      this.state.display = { ...this.state.display, [key]: value };
      saveDisplay(this.state.display);
      this.render();
    }

    onInput(event) {
      const target = event.target;
      if (target.matches("[data-input]")) this.state.input = target.value;
      else if (target.matches("[data-scene-input]")) this.state.sceneInput = target.value;
      else if (target.matches("[data-cast-filter]")) {
        this.state.castFilter = target.value;
        const needle = target.value.trim().toLowerCase();
        for (const row of this.shadowRoot.querySelectorAll(".cast-picker label")) {
          row.hidden = Boolean(needle) && !row.textContent.toLowerCase().includes(needle);
        }
      }
    }

    onClick(event) {
      const target = event.target.closest("[data-action]");
      if (!target || target.disabled) return;
      const { action, id, index, kind } = target.dataset;
      const proposal = this.state.data?.story?.sheet?.proposal;
      if (action === "settings") this.set({ settingsOpen: !this.state.settingsOpen });
      else if (action === "close-settings" && (event.target === target || target.tagName === "BUTTON"))
        this.set({ settingsOpen: false });
      else if (action === "close-settings") return;
      else if (action === "display") this.setDisplay(target.dataset.key, target.dataset.value);
      else if (action === "home") {
        this._token += 1; // A reply still on its way belongs to the story being left.
        this.set({ view: "list", data: null, busy: "" });
        void this.loadList();
      } else if (action === "close") this._props?.onClose?.();
      else if (action === "new") this.set({ view: "new" });
      else if (action === "create") void this.createStory();
      else if (action === "open") void this.openStory(id);
      else if (action === "play") void this.play(kind);
      else if (action === "next") void this.nextScene();
      else if (action === "reroll-plan")
        void this.run("Planning another version…", async () =>
          this.apply(await call(this.storyPath("/propose"), "POST", { instruction: proposal?.instruction ?? "" })),
        );
      else if (action === "discard-plan")
        void this.run("", async () => this.apply(await call(this.storyPath("/proposal"), "DELETE")));
      else if (action === "accept") void this.accept();
      else if (action === "version") this.set({ draftIndex: Number(index) });
      else if (action === "swipe")
        void this.run("", async () =>
          this.apply(await call(this.storyPath(`/turns/${encodeURIComponent(id)}`), "PUT", { active: Number(index) })),
        );
      else if (action === "spine") void this.saveSpine();
      else if (action === "delete-story") void this.deleteStory();
      else void this.turnAction(action, id);
    }

    // ── Views ──

    renderList() {
      const { stories } = this.state;
      const items = (stories ?? [])
        .map(
          (s) => `<div class="card story-item" data-action="open" data-id="${escapeHtml(s.id)}">
            <h2>${escapeHtml(s.title)}</h2>
            <span class="muted">${s.scenes} scene${s.scenes === 1 ? "" : "s"}</span></div>`,
        )
        .join("");
      return `<div class="scroll"><div class="center">
        <div class="row"><button class="primary" data-action="new">New story</button></div>
        ${stories === null ? `<p class="muted">Loading…</p>` : items || `<p class="muted">No stories yet.</p>`}
      </div></div>`;
    }

    renderNew() {
      const library = this.state.library ?? { personas: [], characters: [] };
      const personas = library.personas
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
        .join("");
      const cast = library.characters
        .map(
          (c) => `<label><input type="checkbox" name="cast" value="${escapeHtml(c.id)}"> ${escapeHtml(c.name)}</label>`,
        )
        .join("");
      return `<div class="scroll"><div class="center">
        <h2>New story</h2>
        <label>Title<input name="title"></label>
        <label>Story model (narrator, your turns, scene planner)<select name="model">${this.modelOptions(null)}</select></label>
        <label>You play<select name="persona"><option value="">(no persona)</option>${personas}</select></label>
        <label>Cast<input data-cast-filter placeholder="Filter characters…" value="${escapeHtml(this.state.castFilter)}"></label>
        <div class="cast-picker">${cast || `<span class="muted">No characters in the library.</span>`}</div>
        <label>Premise<textarea name="premise" rows="4" placeholder="What the story is about, the world, the situation at the start."></textarea></label>
        <label>Story goals<textarea name="goals" rows="2" placeholder="Where the story is heading. Targets, not a script."></textarea></label>
        <div class="row"><button class="primary" data-action="create">Create story</button><button data-action="home">Cancel</button></div>
      </div></div>`;
    }

    renderTurn(turn, live, isLast) {
      const persona = turn.speaker === "persona";
      const who = persona ? this.personaName() : "Narrator";
      const versions =
        turn.swipes.length > 1
          ? `<span class="row">${turn.swipes
              .map(
                (_, i) =>
                  `<button class="icon" data-action="swipe" data-id="${turn.id}" data-index="${i}" ${
                    i === turn.active || !live ? "disabled" : ""
                  }>${i + 1}</button>`,
              )
              .join("")}</span>`
          : "";
      const canReroll = live && isLast && (!persona || turn.instruction);
      const tools = live
        ? `<div class="tools">
            ${canReroll ? `<button class="icon" data-action="reroll" data-id="${turn.id}">Reroll</button>` : ""}
            <button class="icon" data-action="edit" data-id="${turn.id}">Edit</button>
            <button class="icon danger" data-action="delete" data-id="${turn.id}">Delete</button>
          </div>`
        : "";
      const text = turn.swipes[turn.active] ?? "";
      const body =
        this.state.editing === turn.id
          ? `<textarea data-edit rows="8">${escapeHtml(text)}</textarea>
             <div class="row"><button class="primary" data-action="save-edit" data-id="${turn.id}">Save</button>
             <button data-action="cancel-edit" data-id="${turn.id}">Cancel</button></div>`
          : `<div>${prose(text)}</div>`;
      return `<div class="turn ${persona ? "persona" : "narrator"} ${live ? "" : "frozen"}">
        <div class="who"><span class="avatar">${escapeHtml(who.slice(0, 1))}</span>${escapeHtml(who)} ${versions}</div>
        ${turn.instruction ? `<div class="instruction">From: ${escapeHtml(turn.instruction)}</div>` : ""}
        ${body}${tools}
      </div>`;
    }

    renderOutcomes(scene) {
      return scene.outcomes?.length
        ? `<ul>${scene.outcomes
            .map((o) => `<li class="goal-${o.status}">${escapeHtml(o.goal)} (${o.status})</li>`)
            .join("")}</ul>`
        : "";
    }

    renderWriting() {
      const { speaker, text } = this.state.writing;
      return `<div class="turn ${speaker === "persona" ? "persona" : "narrator"} writing">
        <div class="who"><span class="avatar">${escapeHtml((speaker === "persona" ? this.personaName() : "N").slice(0, 1))}</span>${escapeHtml(speaker === "persona" ? this.personaName() : "Narrator")}</div>
        <div data-writing>${text ? prose(text) : `<p class="muted">Writing…</p>`}</div>
      </div>`;
    }

    renderTranscript() {
      const { story, turns } = this.state.data;
      const scenes = story.sheet.scenes;
      if (!scenes.length) {
        return `<p class="muted">No scenes yet. Plan the first scene in the panel${
          story.sheet.spine.premise ? "" : ", or describe the story first in Settings"
        }.</p>`;
      }
      return scenes
        .map((scene, i) => {
          const live = scene.summary === null;
          const sceneTurns = turns[scene.id] ?? [];
          return `<div class="scene-head"><h3>Scene ${i + 1}: ${escapeHtml(scene.plan.title)}</h3>
              ${scene.plan.location ? `<span class="muted">${escapeHtml(scene.plan.location)}</span>` : ""}</div>
            ${sceneTurns.map((t, j) => this.renderTurn(t, live, j === sceneTurns.length - 1)).join("")}
            ${live && this.state.writing ? this.renderWriting() : ""}
            ${
              live
                ? ""
                : `<details class="card"><summary>Scene summary</summary><p>${escapeHtml(scene.summary)}</p>${this.renderOutcomes(scene)}</details>`
            }`;
        })
        .join("");
    }

    renderPlan(plan) {
      const list = (items) =>
        items?.length ? `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : "";
      return `
        ${plan.location ? `<p><b>Where:</b> ${escapeHtml(plan.location)}</p>` : ""}
        ${plan.cast?.length ? `<h4>Present</h4>${list(plan.cast)}` : ""}
        ${plan.goals?.length ? `<h4>For</h4>${list(plan.goals)}` : ""}
        ${plan.facts?.length ? `<h4>Facts</h4>${list(plan.facts)}` : ""}`;
    }

    /** The scene's prompt-cache measure (KPI 1), once a call has reported usage. */
    renderStats(stats) {
      if (!stats?.calls) return "";
      const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
      return `<p class="muted" title="Cache reads ${k(stats.read)}, writes ${k(stats.write)}, uncached ${k(stats.input)}, output ${k(stats.output)}">
        Prompt cache: ${Math.round(stats.readShare * 100)}% read over ${stats.calls} call${stats.calls === 1 ? "" : "s"} ·
        ${k(stats.equivalents)} token-equivalents</p>`;
    }

    renderReview(proposal) {
      const plans = proposal.plans;
      const index = Math.max(0, Math.min(this.state.draftIndex, plans.length - 1));
      const plan = plans[index];
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
                (_, i) =>
                  `<button class="icon" data-action="version" data-index="${i}" ${i === index ? "disabled" : ""}>v${i + 1}</button>`,
              )
              .join("")}</div>`
          : "";
      return `<div class="card">
        <h3>Proposed scene</h3>
        ${proposal.instruction ? `<p class="muted">From: ${escapeHtml(proposal.instruction)}</p>` : ""}
        ${versions}
        ${PLAN_FIELDS.map(field).join("")}
        <div class="row">
          <button class="primary" data-action="accept">Accept</button>
          <button data-action="reroll-plan">Reroll</button>
          <button data-action="discard-plan">Discard</button>
        </div></div>`;
    }

    renderSide() {
      const sheet = this.state.data.story.sheet;
      const scene = this.openScene();
      const current = scene
        ? `<div class="card"><h3>Scene ${sheet.scenes.length}: ${escapeHtml(scene.plan.title)}</h3>${this.renderPlan(
            scene.plan,
          )}${this.renderStats(this.state.data.stats?.[scene.id])}</div>`
        : "";
      const next = sheet.proposal
        ? this.renderReview(sheet.proposal)
        : `<div class="card">
            <label>${sheet.scenes.length ? "Next scene" : "First scene"} (optional direction)
              <textarea data-scene-input rows="2" placeholder="A few hours later, everyone meets to debrief…">${escapeHtml(this.state.sceneInput)}</textarea></label>
            <div class="row"><button class="primary" data-action="next">${scene ? "End scene & plan next" : "Plan scene"}</button></div>
          </div>`;
      return `${current}${next}`;
    }

    renderSettings() {
      const { display, data, view } = this.state;
      const story = view === "story" ? data?.story : null;
      const settings = story?.settings ?? {};
      const segment = (key, options) =>
        `<div class="segmented">${options
          .map(
            ([value, label]) =>
              `<button class="icon ${display[key] === value ? "on" : ""}" data-action="display" data-key="${key}" data-value="${value}" aria-pressed="${
                display[key] === value
              }">${label}</button>`,
          )
          .join("")}</div>`;
      const storySection = story
        ? `<section><h2>Story</h2>
            <label>Title<input data-set="title" value="${escapeHtml(story.title)}"></label>
            <label>Story model (narrator, your turns, scene planner)<select data-set="mainConnectionId">${this.modelOptions(story.mainConnectionId)}</select></label>
            <label>Scene summaries<select data-set="agentConnectionId">${this.modelOptions(story.agentConnectionId, true)}</select></label>
            <label>Turn length<select data-set="replyLength">${[
              ["short", "Short (1–2 paragraphs)"],
              ["medium", "Medium (3–4 paragraphs)"],
              ["long", "Long"],
            ]
              .map(([v, l]) => `<option value="${v}" ${settings.replyLength === v ? "selected" : ""}>${l}</option>`)
              .join("")}</select></label>
            <label class="check"><input type="checkbox" data-set="reviewTurns" ${settings.reviewTurns ? "checked" : ""}>
              Review my turn before the story answers</label>
            <p class="hint">With review on, Act writes only your turn. Edit or reroll it, then press Continue.</p>
            <label>Premise<textarea data-spine="premise" rows="4">${escapeHtml(story.sheet.spine.premise)}</textarea></label>
            <label>Story goals<textarea data-spine="goals" rows="2">${escapeHtml(story.sheet.spine.goals)}</textarea></label>
            <div class="row"><button data-action="spine">Save premise &amp; goals</button>
              <button class="danger" data-action="delete-story">Delete story</button></div>
          </section>`
        : "";
      return `<div class="overlay" data-action="close-settings"><div class="drawer">
        <div class="row"><h2 style="flex:1">Settings</h2><button data-action="close-settings">Done</button></div>
        ${storySection}
        <section><h2>Display</h2><p class="hint">Saved in this browser.</p>
          <label>Text size</label>${segment("size", [
            ["s", "Small"],
            ["m", "Medium"],
            ["l", "Large"],
          ])}
          <label>Reading width</label>${segment("width", [
            ["narrow", "Narrow"],
            ["wide", "Wide"],
          ])}
          <label class="check"><input type="checkbox" data-display="boxes" ${display.boxes ? "checked" : ""}> Put each turn in a box</label>
          <label class="check"><input type="checkbox" data-display="dialogue" ${display.dialogue ? "checked" : ""}> Highlight dialogue</label>
        </section>
      </div></div>`;
    }

    renderStory() {
      if (!this.state.data) return `<div class="scroll"><p class="muted">Loading…</p></div>`;
      const live = Boolean(this.openScene()) && !this.state.data.story.sheet.proposal;
      const name = escapeHtml(this.personaName());
      const story = this.state.data.story;
      const openTurns = this.state.data.turns[this.openScene()?.id] ?? [];
      const awaitingReply = openTurns.at(-1)?.speaker === "persona";
      const composer = live
        ? `<div class="composer"><div class="center">
            ${awaitingReply ? `<p class="hint">Your turn is written. Edit or reroll it, or press Continue for the story's reply.</p>` : ""}
            <textarea data-input rows="2" placeholder="What does ${name} do? A short note is enough.">${escapeHtml(this.state.input)}</textarea>
            <div class="row">
              <button class="primary" data-action="play" data-kind="instruction" title="Your note becomes ${name}'s turn, then the story answers">Act</button>
              <button data-action="play" data-kind="written" title="Use your text as written">Send as written</button>
              <button data-action="play" data-kind="continue" title="Let the story go on">Continue</button>
              <select class="compact" data-set="mainConnectionId" title="Story model">${this.modelOptions(story.mainConnectionId)}</select>
            </div></div></div>`
        : "";
      return `<div class="body">
        <div class="main"><div class="scroll"><div class="center">${this.renderTranscript()}</div></div>${composer}</div>
        <aside class="side">${this.renderSide()}</aside>
      </div>`;
    }

    render() {
      const { view, busy, error, data } = this.state;
      const title = view === "story" && data ? data.story.title : view === "new" ? "New story" : "Call Sheet";
      const content = view === "story" ? this.renderStory() : view === "new" ? this.renderNew() : this.renderList();
      const scrollTop = this.shadowRoot.querySelector(".main .scroll")?.scrollTop;
      const d = this.state.display;
      const classes = ["page", `size-${d.size}`, d.width, d.boxes ? "boxes" : "", d.dialogue ? "dialogue" : ""];
      this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="${classes.join(" ")}">
        <header>
          ${view === "list" ? "" : `<button data-action="home">Stories</button>`}
          <h1>${escapeHtml(title)}</h1>
          ${busy ? `<span class="muted">${escapeHtml(busy)}</span>` : ""}
          ${error ? `<span class="error">${escapeHtml(error)}</span>` : ""}
          <button data-action="settings">Settings</button>
          ${this._props?.onClose ? `<button data-action="close">Close</button>` : ""}
        </header>
        ${content}
        ${this.state.settingsOpen ? this.renderSettings() : ""}
      </div>`;
      if (busy) {
        for (const button of this.shadowRoot.querySelectorAll(
          "button:not([data-action=home]):not([data-action=close]):not([data-action=settings]):not([data-action=close-settings]):not([data-action=display])",
        )) {
          button.disabled = true;
        }
      }
      const scroll = this.shadowRoot.querySelector(".main .scroll");
      if (scroll && scrollTop !== undefined) scroll.scrollTop = scrollTop;
    }
  }

  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, CallSheetElement);
})();
