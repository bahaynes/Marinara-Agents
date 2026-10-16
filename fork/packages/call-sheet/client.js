"use strict";

// Call Sheet's Home page: the story list, and for one story the transcript, the chat box and the scene
// panel (current plan, Next scene, and the review step for a proposed scene).
//
// It renders in the page itself (no shadow root) and is drawn with Marinara's own visual language: the
// theme tokens, the safelisted utility classes, the `mari-chrome-control` buttons and the Roleplay
// message classes. The only CSS here is layout. Text size, text color and bold dialogue follow the
// player's Roleplay settings, and dialogue takes each character's card colors.
(() => {
  const TAG_NAME = "marinara-capability-call-sheet";
  const API = "/api/call-sheet/v1";
  const ENGINE_UI_KEY = "marinara-engine-ui";
  const PLAN_FIELDS = [
    ["title", "Title", "input"],
    ["location", "Location", "input"],
    ["cast", "Present (one per line)", "list"],
    ["goals", "What this scene is for (one per line)", "list"],
    ["facts", "Facts in play (one per line)", "list"],
    ["opening", "Opening", "text"],
  ];
  const NON_TEXT_PROVIDERS = new Set(["image_generation", "video_generation", "audio_generation", "decision"]);

  // Shared class strings, all from Marinara's package safelist.
  const BTN = "mari-chrome-control mari-chrome-control--small px-3";
  const BTN_PRIMARY = `${BTN} mari-chrome-control--primary`;
  const BTN_DANGER = `${BTN} mari-chrome-control--danger`;
  const FIELD =
    "w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
  const CARD = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 space-y-2";
  const LABEL = "grid gap-1 text-xs text-[var(--muted-foreground)]";
  const MUTED = "text-xs text-[var(--muted-foreground)]";

  // Layout only. Everything visual comes from the host's classes above.
  const LAYOUT_CSS = `
    marinara-capability-call-sheet { display: block; height: 100%; }
    .cs-root { height: 100%; display: flex; flex-direction: column; min-height: 0; position: relative; }
    .cs-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 15rem minmax(0, 1fr) 22rem; }
    .cs-body.cs-solo { grid-template-columns: minmax(0, 1fr); }
    .cs-col { min-height: 0; overflow-y: auto; }
    .cs-stories, .cs-side { border-color: var(--border); }
    .cs-stories { border-right-width: 1px; border-right-style: solid; }
    .cs-side { border-left-width: 1px; border-left-style: solid; }
    .cs-main { display: flex; flex-direction: column; min-height: 0; }
    .cs-text { overflow-wrap: break-word; }
    .cs-turn .cs-tools { opacity: 0; transition: opacity 150ms ease; }
    .cs-turn:hover .cs-tools, .cs-turn:focus-within .cs-tools { opacity: 1; }
    .cs-rule { display: flex; align-items: center; gap: 0.5rem; }
    .cs-rule::before, .cs-rule::after { content: ""; flex: 1; height: 1px; background: currentColor; opacity: 0.3; }
    .cs-drawer { border-left: 1px solid var(--border); }
    .cs-active { outline: 1px solid var(--primary); }
    @media (max-width: 1100px) {
      .cs-body { grid-template-columns: minmax(0, 1fr) 20rem; }
      .cs-stories { display: none; }
    }
    @media (max-width: 820px) {
      .cs-body, .cs-body.cs-solo { display: block; overflow-y: auto; }
      .cs-main { height: calc(100% - 4px); min-height: 26rem; }
      .cs-side { border-left: none; border-top: 1px solid var(--border); }
      .cs-turn .cs-tools { opacity: 1; }
    }
  `;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  /** A card color the page can use as `color` (Marinara also allows gradients, which text color cannot take). */
  const solidColor = (value) => {
    const color = String(value ?? "").trim();
    return color && !/gradient\(/iu.test(color) && /^[#a-z0-9(),.%\s-]+$/iu.test(color) ? color : "";
  };

  /** The player's Roleplay text settings, as the Engine saved them; defaults if they cannot be read. */
  function engineTextPrefs() {
    try {
      const state = JSON.parse(globalThis.localStorage?.getItem(ENGINE_UI_KEY) || "{}").state ?? {};
      return {
        fontSize: Number(state.chatFontSize) > 0 ? Number(state.chatFontSize) : 16,
        fontColor: solidColor(state.chatFontColor),
        boldDialogue: state.boldDialogue !== false,
      };
    } catch {
      return { fontSize: 16, fontColor: "", boldDialogue: true };
    }
  }

  /**
   * A turn's text, drawn the way Roleplay draws a message: quoted dialogue stands out (bold when the
   * player keeps bold dialogue on) in the speaking character's dialogue color, taken from
   * <speaker="Name"> tags; *italics* and **bold** apply.
   */
  function storyText(value, colors, prefs) {
    const tag = prefs.boldDialogue ? "strong" : "span";
    const quotes = (escaped, color) =>
      escaped.replace(/(&quot;[^\n]*?&quot;|“[^”\n]*”)/gu, (quote) =>
        color
          ? `<${tag} style="color:${color}">${quote}</${tag}>`
          : `<${tag} class="text-[var(--foreground)]">${quote}</${tag}>`,
      );
    const segments = [];
    const re = /<speaker="([^"]*)">([\s\S]*?)(?:<\/speaker>|$)/gu;
    let last = 0;
    let match;
    const raw = String(value ?? "");
    while ((match = re.exec(raw)) !== null) {
      segments.push(quotes(escapeHtml(raw.slice(last, match.index)), ""));
      segments.push(quotes(escapeHtml(match[2]), colors.get(match[1].trim().toLowerCase()) ?? ""));
      last = match.index + match[0].length;
    }
    segments.push(quotes(escapeHtml(raw.slice(last).replace(/<\/?speaker[^>]*>?/gu, "")), ""));
    return segments
      .join("")
      .replace(/\*\*([^*\n]+)\*\*/gu, "<b>$1</b>")
      .replace(/\*([^*\n]+)\*/gu, "<i>$1</i>");
  }

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

  /** The Engine's text-model connections, for the story model pickers. */
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

  class CallSheetElement extends HTMLElement {
    constructor() {
      super();
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
        settingsOpen: false,
      };
      this._props = null;
      this._token = 0;
      this.addEventListener("click", (event) => this.onClick(event));
      this.addEventListener("input", (event) => this.onInput(event));
      this.addEventListener("change", (event) => this.onChange(event));
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
      this.set({ view: "story", storyId, data: null, editing: null, input: "", sceneInput: "", settingsOpen: false });
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
        const listed = this.state.stories?.find((s) => s.id === result.id);
        if (listed) Object.assign(listed, { title: result.title, scenes: result.sheet.scenes.length });
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

    persona() {
      const id = this.state.data?.story?.personaId;
      return this.state.library?.personas.find((p) => p.id === id) ?? { name: "You" };
    }

    /** Lower-cased name → dialogue color, for the story's cast and persona. */
    dialogueColors() {
      const story = this.state.data?.story;
      const colors = new Map();
      for (const c of this.state.library?.characters ?? []) {
        if (story?.characterIds?.includes(c.id) && solidColor(c.dialogueColor)) {
          colors.set(c.name.toLowerCase(), solidColor(c.dialogueColor));
        }
      }
      const persona = this.persona();
      if (solidColor(persona.dialogueColor)) colors.set(persona.name.toLowerCase(), solidColor(persona.dialogueColor));
      return colors;
    }

    $(selector) {
      return this.querySelector(selector);
    }

    scrollToEnd() {
      requestAnimationFrame(() => {
        const scroll = this.$("[data-transcript]");
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
      });
    }

    // ── Actions ──

    async createStory() {
      const value = (name) => this.$(`[name="${name}"]`)?.value ?? "";
      const characterIds = [...this.querySelectorAll("[name=cast]:checked")].map((box) => box.value);
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
      if (created) {
        await this.loadList();
        await this.openStory(created.id);
      }
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
            const node = this.$("[data-writing]");
            if (node) node.innerHTML = storyText(this.state.writing.text, this.dialogueColors(), engineTextPrefs());
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
        const value = this.$(`[data-field="${key}"]`)?.value ?? "";
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
        const text = this.$("[data-edit]")?.value ?? "";
        await this.run("", async () => {
          this.apply(await call(path, "PUT", { text }));
          this.state.editing = null;
        });
      }
    }

    async saveSpine() {
      const spine = {
        premise: this.$("[data-spine=premise]")?.value ?? "",
        goals: this.$("[data-spine=goals]")?.value ?? "",
      };
      await this.run("Saving…", async () => this.apply(await call(this.storyPath("/spine"), "PUT", spine)));
    }

    async deleteStory() {
      if (!confirm("Delete this story for good?")) return;
      await this.run("Deleting…", async () => {
        await call(this.storyPath(), "DELETE");
        Object.assign(this.state, { view: "list", data: null, settingsOpen: false });
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

    /** Story settings save when a field changes. */
    onChange(event) {
      const target = event.target;
      const key = target.dataset?.set;
      if (!key) return;
      const value = target.type === "checkbox" ? target.checked : target.value || null;
      if (key === "title" && !value) return;
      void this.run("Saving…", async () =>
        this.apply(await call(this.storyPath("/settings"), "PUT", { [key]: value })),
      );
    }

    onInput(event) {
      const target = event.target;
      if (target.matches("[data-input]")) this.state.input = target.value;
      else if (target.matches("[data-scene-input]")) this.state.sceneInput = target.value;
      else if (target.matches("[data-cast-filter]")) {
        this.state.castFilter = target.value;
        const needle = target.value.trim().toLowerCase();
        for (const row of this.querySelectorAll("[data-cast-row]")) {
          row.hidden = Boolean(needle) && !row.textContent.toLowerCase().includes(needle);
        }
      }
    }

    onClick(event) {
      const target = event.target.closest("[data-action]");
      if (!target || target.disabled || !this.contains(target)) return;
      const { action, id, index, kind } = target.dataset;
      const proposal = this.state.data?.story?.sheet?.proposal;
      if (action === "settings") this.set({ settingsOpen: !this.state.settingsOpen });
      else if (action === "close-settings") {
        // The backdrop closes the drawer only when it is clicked itself, not through the drawer.
        if (event.target === target || target.tagName === "BUTTON") this.set({ settingsOpen: false });
      } else if (action === "home") {
        this._token += 1; // A reply still on its way belongs to the story being left.
        this.set({ view: "list", data: null, busy: "", settingsOpen: false });
        void this.loadList();
      } else if (action === "close") this._props?.onClose?.();
      else if (action === "new") this.set({ view: "new", settingsOpen: false });
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

    renderStoryList(compact) {
      const { stories, storyId, view } = this.state;
      const items = (stories ?? [])
        .map(
          (s) => `<button type="button" data-action="open" data-id="${escapeHtml(s.id)}"
            class="${CARD} block w-full text-left hover:bg-[var(--accent)] ${view === "story" && s.id === storyId ? "cs-active" : ""}">
            <div class="truncate text-sm font-semibold">${escapeHtml(s.title)}</div>
            <div class="${MUTED}">${s.scenes} scene${s.scenes === 1 ? "" : "s"}</div></button>`,
        )
        .join("");
      return `<div class="${compact ? "p-3" : "mx-auto max-w-3xl p-4"} space-y-2">
        <button type="button" class="${BTN_PRIMARY} w-full" data-action="new">New story</button>
        ${stories === null ? `<p class="${MUTED}">Loading…</p>` : items || `<p class="${MUTED}">No stories yet.</p>`}
      </div>`;
    }

    renderNew() {
      const library = this.state.library ?? { personas: [], characters: [] };
      const personas = library.personas
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
        .join("");
      const cast = library.characters
        .map(
          (c) => `<label data-cast-row class="flex items-center gap-2 px-2 py-1 text-sm">
            <input type="checkbox" name="cast" value="${escapeHtml(c.id)}">
            <span ${solidColor(c.nameColor) ? `style="color:${solidColor(c.nameColor)}"` : ""}>${escapeHtml(c.name)}</span></label>`,
        )
        .join("");
      return `<div class="mx-auto max-w-3xl space-y-3 p-4">
        <h2 class="text-lg font-semibold">New story</h2>
        <label class="${LABEL}">Title<input class="${FIELD}" name="title"></label>
        <label class="${LABEL}">Story model (narrator, your turns, scene planner)
          <select class="${FIELD}" name="model">${this.modelOptions(null)}</select></label>
        <label class="${LABEL}">You play<select class="${FIELD}" name="persona"><option value="">(no persona)</option>${personas}</select></label>
        <label class="${LABEL}">Cast<input class="${FIELD}" data-cast-filter placeholder="Filter characters…" value="${escapeHtml(this.state.castFilter)}"></label>
        <div class="max-h-72 overflow-y-auto rounded-lg ring-1 ring-[var(--border)]">${cast || `<p class="${MUTED} p-2">No characters in the library.</p>`}</div>
        <label class="${LABEL}">Premise<textarea class="${FIELD} resize-y" name="premise" rows="4" placeholder="What the story is about, the world, the situation at the start."></textarea></label>
        <label class="${LABEL}">Story goals<textarea class="${FIELD} resize-y" name="goals" rows="2" placeholder="Where the story is heading. Targets, not a script."></textarea></label>
        <div class="flex gap-2"><button type="button" class="${BTN_PRIMARY}" data-action="create">Create story</button>
          <button type="button" class="${BTN}" data-action="home">Cancel</button></div>
      </div>`;
    }

    /** One turn, in Roleplay's message shapes: the narrator's ruled bubble, or the persona with avatar. */
    renderTurn(turn, live, isLast, prefs, colors) {
      const persona = turn.speaker === "persona";
      const who = this.persona();
      const text = turn.swipes[turn.active] ?? "";
      const textStyle = `font-size:${prefs.fontSize}px;line-height:1.5;${prefs.fontColor ? `color:${prefs.fontColor};` : ""}`;
      const versions =
        turn.swipes.length > 1
          ? turn.swipes
              .map(
                (_, i) =>
                  `<button type="button" class="${BTN}" data-action="swipe" data-id="${turn.id}" data-index="${i}"
                    aria-pressed="${i === turn.active}" ${!live ? "disabled" : ""}>${i + 1}</button>`,
              )
              .join("")
          : "";
      const canReroll = live && isLast && (!persona || turn.instruction);
      const tools = live
        ? `<div class="cs-tools mt-2 flex flex-wrap justify-end gap-1">
            ${versions}
            ${canReroll ? `<button type="button" class="${BTN}" data-action="reroll" data-id="${turn.id}">Reroll</button>` : ""}
            <button type="button" class="${BTN}" data-action="edit" data-id="${turn.id}">Edit</button>
            <button type="button" class="${BTN_DANGER}" data-action="delete" data-id="${turn.id}">Delete</button>
          </div>`
        : "";
      const body =
        this.state.editing === turn.id
          ? `<textarea class="${FIELD} resize-y" data-edit rows="8">${escapeHtml(text)}</textarea>
             <div class="mt-2 flex gap-2"><button type="button" class="${BTN_PRIMARY}" data-action="save-edit" data-id="${turn.id}">Save</button>
             <button type="button" class="${BTN}" data-action="cancel-edit" data-id="${turn.id}">Cancel</button></div>`
          : `<div class="mari-message-content whitespace-pre-wrap cs-text" style="${textStyle}">${storyText(text, colors, prefs)}</div>`;
      if (!persona) {
        return `<div class="mari-message mari-message-narrator cs-turn mb-4 px-2">
          <div class="mari-message-bubble mari-chat-style-surface relative rounded-xl border border-amber-500/25 bg-black/25 px-5 py-4">
            <div class="cs-rule mb-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-amber-400">Narrator</div>
            ${body}${tools}
          </div></div>`;
      }
      const avatar = who.avatarPath
        ? `<img class="h-8 w-8 shrink-0 rounded-full object-cover" src="${escapeHtml(who.avatarPath)}" alt="">`
        : `<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-xs font-semibold">${escapeHtml(who.name.slice(0, 1))}</span>`;
      const nameStyle = solidColor(who.nameColor) ? `style="color:${solidColor(who.nameColor)}"` : "";
      return `<div class="mari-message mari-message-user cs-turn mb-4 flex gap-3 px-2">
        ${avatar}
        <div class="min-w-0 flex-1">
          <div class="mb-1 flex items-baseline gap-2 px-1">
            <span class="text-xs font-semibold" ${nameStyle}>${escapeHtml(who.name)}</span>
            ${turn.instruction ? `<span class="${MUTED} truncate">from: ${escapeHtml(turn.instruction)}</span>` : ""}
          </div>
          <div class="mari-message-bubble mari-chat-style-surface rounded-xl border border-[var(--border)] bg-[var(--primary)]/10 px-4 py-3">
            ${body}${tools}
          </div>
        </div></div>`;
    }

    renderWriting(prefs, colors) {
      const { speaker, text } = this.state.writing;
      const preview = { id: "writing", speaker, swipes: [text], active: 0, instruction: "" };
      const html = this.renderTurn(preview, false, false, prefs, colors);
      // The streamed text is filled in place by streamTurn.
      return html.replace(
        /<div class="mari-message-content([^"]*)" style="([^"]*)">[\s\S]*?<\/div>/u,
        `<div class="mari-message-content$1" style="$2" data-writing>${text ? storyText(text, colors, prefs) : "…"}</div>`,
      );
    }

    renderOutcomes(scene) {
      return scene.outcomes?.length
        ? `<ul class="list-disc pl-4 text-xs">${scene.outcomes
            .map(
              (o) =>
                `<li class="${o.status === "met" ? "text-emerald-300" : o.status === "failed" ? "text-red-300" : ""}">${escapeHtml(o.goal)} (${o.status})</li>`,
            )
            .join("")}</ul>`
        : "";
    }

    renderTranscript() {
      const { story, turns } = this.state.data;
      const scenes = story.sheet.scenes;
      if (!scenes.length) {
        return `<p class="${MUTED} p-4">No scenes yet. Plan the first scene in the panel${
          story.sheet.spine.premise ? "" : ", or describe the story first in Settings"
        }.</p>`;
      }
      const prefs = engineTextPrefs();
      const colors = this.dialogueColors();
      return scenes
        .map((scene, i) => {
          const live = scene.summary === null;
          const sceneTurns = turns[scene.id] ?? [];
          return `<div class="mb-3 mt-5 text-center">
              <div class="cs-rule text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-[var(--muted-foreground)]">Scene ${i + 1}: ${escapeHtml(scene.plan.title)}</div>
              ${scene.plan.location ? `<div class="${MUTED} mt-1">${escapeHtml(scene.plan.location)}</div>` : ""}</div>
            ${sceneTurns.map((t, j) => this.renderTurn(t, live, j === sceneTurns.length - 1, prefs, colors)).join("")}
            ${live && this.state.writing ? this.renderWriting(prefs, colors) : ""}
            ${
              live
                ? ""
                : `<details class="${CARD} mb-4"><summary class="${MUTED} cursor-pointer">Scene summary</summary>
                    <p class="text-sm leading-relaxed">${escapeHtml(scene.summary)}</p>${this.renderOutcomes(scene)}</details>`
            }`;
        })
        .join("");
    }

    renderPlan(plan) {
      const list = (items) =>
        items?.length
          ? `<ul class="list-disc pl-4">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
          : "";
      const head = (label) => `<div class="mt-2 text-xs font-semibold text-[var(--muted-foreground)]">${label}</div>`;
      return `<div class="text-sm">
        ${plan.location ? `<p>${escapeHtml(plan.location)}</p>` : ""}
        ${plan.cast?.length ? `${head("Present")}${list(plan.cast)}` : ""}
        ${plan.goals?.length ? `${head("For")}${list(plan.goals)}` : ""}
        ${plan.facts?.length ? `${head("Facts")}${list(plan.facts)}` : ""}</div>`;
    }

    /** The scene's prompt-cache measure (KPI 1), once a call has reported usage. */
    renderStats(stats) {
      if (!stats?.calls) return "";
      const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
      return `<p class="${MUTED}" title="Cache reads ${k(stats.read)}, writes ${k(stats.write)}, uncached ${k(stats.input)}, output ${k(stats.output)}">
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
          ? `<label class="${LABEL}">${label}<input class="${FIELD}" data-field="${key}" value="${escapeHtml(value)}"></label>`
          : `<label class="${LABEL}">${label}<textarea class="${FIELD} resize-y" data-field="${key}" rows="${kind === "list" ? 3 : 2}">${escapeHtml(value)}</textarea></label>`;
      };
      const versions =
        plans.length > 1
          ? `<div class="flex flex-wrap gap-1">${plans
              .map(
                (_, i) =>
                  `<button type="button" class="${BTN}" data-action="version" data-index="${i}" aria-pressed="${i === index}">v${i + 1}</button>`,
              )
              .join("")}</div>`
          : "";
      return `<div class="${CARD}">
        <h3 class="text-sm font-semibold">Proposed scene</h3>
        ${proposal.instruction ? `<p class="${MUTED}">From: ${escapeHtml(proposal.instruction)}</p>` : ""}
        ${versions}
        ${PLAN_FIELDS.map(field).join("")}
        <div class="flex flex-wrap gap-2">
          <button type="button" class="${BTN_PRIMARY}" data-action="accept">Accept</button>
          <button type="button" class="${BTN}" data-action="reroll-plan">Reroll</button>
          <button type="button" class="${BTN}" data-action="discard-plan">Discard</button>
        </div></div>`;
    }

    renderSide() {
      const sheet = this.state.data.story.sheet;
      const scene = this.openScene();
      const current = scene
        ? `<div class="${CARD}"><h3 class="text-sm font-semibold">Scene ${sheet.scenes.length}: ${escapeHtml(scene.plan.title)}</h3>
            ${this.renderPlan(scene.plan)}${this.renderStats(this.state.data.stats?.[scene.id])}</div>`
        : "";
      const next = sheet.proposal
        ? this.renderReview(sheet.proposal)
        : `<div class="${CARD}">
            <label class="${LABEL}">${sheet.scenes.length ? "Next scene" : "First scene"} (optional direction)
              <textarea class="${FIELD} resize-y" data-scene-input rows="2" placeholder="A few hours later, everyone meets to debrief…">${escapeHtml(this.state.sceneInput)}</textarea></label>
            <button type="button" class="${BTN_PRIMARY}" data-action="next">${scene ? "End scene & plan next" : "Plan scene"}</button>
          </div>`;
      return `<div class="space-y-3 p-3">${current}${next}</div>`;
    }

    renderSettings() {
      const story = this.state.view === "story" ? this.state.data?.story : null;
      if (!story) return "";
      const settings = story.settings ?? {};
      return `<div class="absolute inset-0 z-40 flex justify-end bg-black/25" data-action="close-settings">
        <div class="cs-drawer h-full w-full max-w-md space-y-3 overflow-y-auto bg-[var(--card)] p-4">
          <div class="flex items-center justify-between"><h2 class="text-lg font-semibold">Story settings</h2>
            <button type="button" class="${BTN}" data-action="close-settings">Done</button></div>
          <label class="${LABEL}">Title<input class="${FIELD}" data-set="title" value="${escapeHtml(story.title)}"></label>
          <label class="${LABEL}">Story model (narrator, your turns, scene planner)
            <select class="${FIELD}" data-set="mainConnectionId">${this.modelOptions(story.mainConnectionId)}</select></label>
          <label class="${LABEL}">Scene summaries
            <select class="${FIELD}" data-set="agentConnectionId">${this.modelOptions(story.agentConnectionId, true)}</select></label>
          <label class="${LABEL}">Turn length<select class="${FIELD}" data-set="replyLength">${[
            ["short", "Short (1–2 paragraphs)"],
            ["medium", "Medium (3–4 paragraphs)"],
            ["long", "Long"],
          ]
            .map(([v, l]) => `<option value="${v}" ${settings.replyLength === v ? "selected" : ""}>${l}</option>`)
            .join("")}</select></label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-set="reviewTurns" ${settings.reviewTurns ? "checked" : ""}>
            Review my turn before the story answers</label>
          <p class="${MUTED}">With review on, Act writes only your turn. Edit or reroll it, then press Continue.
            Text size, text color and bold dialogue follow your Roleplay settings.</p>
          <label class="${LABEL}">Premise<textarea class="${FIELD} resize-y" data-spine="premise" rows="4">${escapeHtml(story.sheet.spine.premise)}</textarea></label>
          <label class="${LABEL}">Story goals<textarea class="${FIELD} resize-y" data-spine="goals" rows="2">${escapeHtml(story.sheet.spine.goals)}</textarea></label>
          <div class="flex flex-wrap gap-2"><button type="button" class="${BTN}" data-action="spine">Save premise &amp; goals</button>
            <button type="button" class="${BTN_DANGER}" data-action="delete-story">Delete story</button></div>
        </div></div>`;
    }

    renderComposer() {
      const story = this.state.data.story;
      const live = Boolean(this.openScene()) && !story.sheet.proposal;
      if (!live) return "";
      const name = escapeHtml(this.persona().name);
      const openTurns = this.state.data.turns[this.openScene().id] ?? [];
      const awaitingReply = openTurns.at(-1)?.speaker === "persona";
      return `<div class="border-t border-[var(--border)] px-4 py-3">
        <div class="mx-auto max-w-3xl space-y-2">
          ${awaitingReply ? `<p class="${MUTED}">Your turn is written. Edit or reroll it, or press Continue for the story's reply.</p>` : ""}
          <div class="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
            <textarea data-input rows="2" placeholder="What does ${name} do? A short note is enough."
              class="mari-chat-input-textarea max-h-[12.5rem] w-full resize-none bg-transparent text-sm text-[var(--foreground)] placeholder:text-foreground/30 outline-none">${escapeHtml(this.state.input)}</textarea>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" class="${BTN_PRIMARY}" data-action="play" data-kind="instruction" title="Your note becomes ${name}'s turn, then the story answers">Act</button>
            <button type="button" class="${BTN}" data-action="play" data-kind="written" title="Use your text as written">Send as written</button>
            <button type="button" class="${BTN}" data-action="play" data-kind="continue" title="Let the story go on">Continue</button>
            <select class="ml-auto max-w-xs rounded-lg bg-[var(--secondary)] px-2 py-1 text-xs ring-1 ring-[var(--border)]" data-set="mainConnectionId" title="Story model">${this.modelOptions(story.mainConnectionId)}</select>
          </div>
        </div></div>`;
    }

    renderStory() {
      if (!this.state.data) return `<div class="cs-body cs-solo"><p class="${MUTED} p-4">Loading…</p></div>`;
      return `<div class="cs-body">
        <aside class="cs-col cs-stories">${this.renderStoryList(true)}</aside>
        <main class="cs-main"><div class="cs-col flex-1 px-2 py-2" data-transcript><div class="mx-auto max-w-3xl">${this.renderTranscript()}</div></div>
          ${this.renderComposer()}</main>
        <aside class="cs-col cs-side">${this.renderSide()}</aside>
      </div>`;
    }

    render() {
      const { view, busy, error, data } = this.state;
      const title = view === "story" && data ? data.story.title : view === "new" ? "New story" : "Call Sheet";
      const content =
        view === "story"
          ? this.renderStory()
          : `<div class="cs-body cs-solo"><div class="cs-col">${view === "new" ? this.renderNew() : this.renderStoryList(false)}</div></div>`;
      const scrollTop = this.$("[data-transcript]")?.scrollTop;
      const focusedKey =
        document.activeElement && this.contains(document.activeElement) ? focusKey(document.activeElement) : null;
      this.innerHTML = `<style>${LAYOUT_CSS}</style><div class="cs-root text-[var(--foreground)]">
        <header class="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
          ${view === "list" ? "" : `<button type="button" class="${BTN}" data-action="home">Stories</button>`}
          <h1 class="min-w-0 flex-1 truncate text-base font-semibold">${escapeHtml(title)}</h1>
          ${busy ? `<span class="${MUTED}">${escapeHtml(busy)}</span>` : ""}
          ${error ? `<span class="text-xs text-red-300">${escapeHtml(error)}</span>` : ""}
          ${view === "story" && data ? `<button type="button" class="${BTN}" data-action="settings">Settings</button>` : ""}
          ${this._props?.onClose ? `<button type="button" class="${BTN}" data-action="close">Close</button>` : ""}
        </header>
        ${content}
        ${this.state.settingsOpen ? this.renderSettings() : ""}
      </div>`;
      if (busy) {
        for (const button of this.querySelectorAll("button")) {
          if (!["home", "close", "settings", "close-settings"].includes(button.dataset.action)) button.disabled = true;
        }
      }
      const scroll = this.$("[data-transcript]");
      if (scroll && scrollTop !== undefined) scroll.scrollTop = scrollTop;
      if (focusedKey) this.$(focusedKey)?.focus();
    }
  }

  /** A selector that finds the same field after a re-render, so typing keeps its focus. */
  function focusKey(element) {
    for (const attribute of ["data-input", "data-scene-input", "data-cast-filter", "data-edit"]) {
      if (element.hasAttribute(attribute)) return `[${attribute}]`;
    }
    return null;
  }

  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, CallSheetElement);
})();
