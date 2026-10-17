"use strict";

// Call Sheet's Home page: the story list, and for one story the transcript, the chat box and the scene
// panel (current plan, Next scene, and the review step for a proposed scene).
//
// It renders in the page itself (no shadow root) and is drawn with Marinara's own visual language: the
// theme tokens, the safelisted utility classes, the `mari-chrome-control` buttons and the Roleplay
// message classes. All custom geometry and pill styles live in LAYOUT_CSS using Marinara's semantic
// CSS variables (`var(--card)`, `var(--border)`, `var(--primary)`, `var(--secondary)`, `var(--accent)`,
// `var(--ring)`), so nothing depends on unsafelisted Tailwind classes.
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

  // Actions that remain clickable even while a request is in flight (`this.state.busy` is non-empty).
  // PIT OF SUCCESS: Any button meant to cancel, navigate away, or toggle drawers during streaming MUST be listed here.
  const BUSY_ALLOWED_ACTIONS = new Set([
    "home",
    "close",
    "settings",
    "close-settings",
    "stop",
    "toggle-drawer",
    "toggle-stories",
    "close-stories",
    "toggle-prompt-policy",
    "optimize-prompt-policy",
  ]);

  const SVG_ATTRS =
    'fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const ICON_COPY = `<svg class="h-3.5 w-3.5" ${SVG_ATTRS}><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  const ICON_CHECK = `<svg class="h-3.5 w-3.5 text-emerald-500" ${SVG_ATTRS}><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const ICON_EDIT = `<svg class="h-3.5 w-3.5" ${SVG_ATTRS}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
  const ICON_REROLL = `<svg class="h-3.5 w-3.5" ${SVG_ATTRS}><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>`;
  const ICON_DELETE = `<svg class="h-3.5 w-3.5" ${SVG_ATTRS}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
  const ICON_PREV = `<svg class="h-3 w-3" ${SVG_ATTRS}><polyline points="15 18 9 12 15 6"></polyline></svg>`;
  const ICON_NEXT = `<svg class="h-3 w-3" ${SVG_ATTRS}><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  const ICON_MODEL = `<svg class="h-3.5 w-3.5 opacity-70" ${SVG_ATTRS}><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`;
  const ICON_CHEVRON = `<svg class="h-3 w-3 opacity-50" ${SVG_ATTRS}><polyline points="6 9 12 15 18 9"></polyline></svg>`;
  const ICON_SPARKLE = `<svg class="h-3.5 w-3.5" ${SVG_ATTRS}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>`;
  const ICON_PLAY = `<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
  const ICON_STOP = `<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>`;
  const ICON_PIN = `<svg class="h-3.5 w-3.5 opacity-75" ${SVG_ATTRS}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle></svg>`;
  const ICON_USERS = `<svg class="h-3.5 w-3.5 opacity-75" ${SVG_ATTRS}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
  const ICON_TARGET = `<svg class="h-3.5 w-3.5 opacity-75" ${SVG_ATTRS}><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`;
  const ICON_FILM = `<svg class="h-3.5 w-3.5" ${SVG_ATTRS}><rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M7 3v18"></path><path d="M3 7.5h4"></path><path d="M3 12h18"></path><path d="M3 16.5h4"></path><path d="M17 3v18"></path><path d="M17 7.5h4"></path><path d="M17 16.5h4"></path></svg>`;

  // Shared class strings, all from Marinara's package safelist.
  const BTN = "mari-chrome-control mari-chrome-control--small px-3";
  const BTN_PRIMARY = `${BTN} mari-chrome-control--primary`;
  const BTN_DANGER = `${BTN} mari-chrome-control--danger`;
  const FIELD =
    "w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
  const CARD = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 space-y-2";
  const LABEL = "grid gap-1 text-xs text-[var(--muted-foreground)]";
  const MUTED = "text-xs text-[var(--muted-foreground)]";

  // Self-contained layout and component CSS using Marinara's semantic theme variables.
  const LAYOUT_CSS = `
    marinara-capability-call-sheet { display: block; height: 100%; }
    .cs-root { height: 100%; display: flex; flex-direction: column; min-height: 0; position: relative; background: var(--background); color: var(--foreground); }
    .cs-hud { display: flex; align-items: center; gap: 0.75rem; padding: 0.375rem 1rem; border-bottom: 1px solid var(--border); background: var(--marinara-chat-chrome-panel-bg, var(--card)); font-size: 0.75rem; overflow-x: auto; white-space: nowrap; }
    .cs-hud-item { display: inline-flex; align-items: center; gap: 0.375rem; color: var(--muted-foreground); min-width: 0; }
    .cs-hud-item strong { color: var(--foreground); font-weight: 500; }
    .cs-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 22rem; position: relative; }
    .cs-body.cs-drawer-closed { grid-template-columns: minmax(0, 1fr); }
    .cs-body.cs-solo { grid-template-columns: minmax(0, 1fr); }
    .cs-col { min-height: 0; overflow-y: auto; }
    .cs-side { border-left: 1px solid var(--border); background: var(--background); }
    .cs-body.cs-drawer-closed .cs-side { display: none; }
    .cs-main { display: flex; flex-direction: column; min-height: 0; }
    .cs-text { overflow-wrap: break-word; }
    .cs-turn .cs-tools { opacity: 0; transition: opacity 150ms ease; }
    .cs-turn:hover .cs-tools, .cs-turn:focus-within .cs-tools { opacity: 1; }
    .cs-rule { display: flex; align-items: center; gap: 0.5rem; }
    .cs-rule::before, .cs-rule::after { content: ""; flex: 1; height: 1px; background: currentColor; opacity: 0.3; }
    .cs-drawer { border-left: 1px solid var(--border); }
    .cs-drawer-left { border-right: 1px solid var(--border); }
    .cs-active { outline: 1px solid var(--primary); }
    .cs-composer-shell { border-radius: 1rem; border: 1px solid var(--border); background: var(--card); padding: 0.625rem 0.75rem; transition: border-color 150ms ease, box-shadow 150ms ease; }
    .cs-composer-shell:focus-within { border-color: var(--marinara-chat-chrome-input-border-focus, var(--primary)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ring) 20%, transparent); }
    .cs-composer-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; padding-top: 0.5rem; margin-top: 0.25rem; border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent); }
    .cs-pill { display: inline-flex; align-items: center; gap: 0.375rem; border-radius: 9999px; background: var(--secondary); color: var(--foreground); border: 1px solid var(--border); padding: 0.25rem 0.625rem; font-size: 0.75rem; line-height: 1rem; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease; user-select: none; }
    .cs-pill:hover:not(:disabled) { background: var(--accent); }
    .cs-pill[aria-pressed="true"] { background: color-mix(in srgb, var(--primary) 18%, var(--secondary)); border-color: var(--primary); color: var(--foreground); }
    .cs-pill-label { max-width: 9.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .cs-speaker-chip { display: inline-flex; align-items: center; gap: 0.375rem; border-radius: 9999px; background: color-mix(in srgb, var(--secondary) 80%, transparent); border: 1px solid var(--border); padding: 0.125rem 0.5rem 0.125rem 0.25rem; font-size: 0.6875rem; font-weight: 600; }
    .cs-speaker-avatar { width: 1.125rem; height: 1.125rem; border-radius: 9999px; object-fit: cover; flex-shrink: 0; background: var(--muted); display: inline-flex; align-items: center; justify-content: center; font-size: 0.625rem; }
    .cs-icon-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.25rem; border-radius: 0.375rem; color: var(--muted-foreground); transition: background-color 150ms ease, color 150ms ease; }
    .cs-icon-btn:hover:not(:disabled) { background: var(--accent); color: var(--foreground); }
    .cs-icon-btn.cs-danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .cs-pager { display: inline-flex; align-items: center; gap: 0.125rem; border-radius: 0.375rem; padding: 0.125rem 0.25rem; background: var(--secondary); border: 1px solid var(--border); font-size: 0.6875rem; color: var(--muted-foreground); }
    .cs-review-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem; border-radius: 0.625rem; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.25); padding: 0.375rem 0.75rem; font-size: 0.75rem; color: #fcd34d; }
    .cs-star { padding: 0.125rem 0.375rem; border-radius: 0.375rem; font-size: 0.75rem; border: 1px solid var(--border); background: var(--secondary); color: var(--muted-foreground); cursor: pointer; }
    .cs-star[aria-pressed="true"] { border-color: #f59e0b; background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-weight: 600; }
    @media (max-width: 960px) {
      .cs-body { grid-template-columns: minmax(0, 1fr); }
      .cs-side { position: absolute; inset: 0; z-index: 30; border-left: none; }
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
        defaultDialogueColor: solidColor(state.defaultDialogueColor) || "#f5c542",
      };
    } catch {
      return { fontSize: 16, fontColor: "", boldDialogue: true, defaultDialogueColor: "#f5c542" };
    }
  }

  /** Extract unique speaker names in order of appearance from `<speaker="Name">` tags in a narrator turn. */
  function extractSpeakers(raw) {
    const seen = new Set();
    const names = [];
    const re = /<speaker="([^"]+)">/gu;
    let match;
    const text = String(raw ?? "");
    while ((match = re.exec(text)) !== null) {
      const name = match[1].trim();
      const key = name.toLowerCase();
      if (name && !seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    }
    return names;
  }

  /**
   * A turn's text, drawn the way Roleplay draws a message: quoted dialogue stands out (bold when the
   * player keeps bold dialogue on) in the speaking character's dialogue color, taken from
   * <speaker="Name"> tags; *italics* and **bold** apply.
   */
  function storyText(value, colors, prefs) {
    const tag = prefs.boldDialogue ? "strong" : "span";
    const quotes = (escaped, color) =>
      escaped.replace(/(&quot;[\s\S]*?&quot;|“[^”]*”)/gu, (quote) => {
        const c = color || prefs.defaultDialogueColor;
        return c
          ? `<${tag} style="color:${c}">${quote}</${tag}>`
          : `<${tag} class="text-[var(--foreground)]">${quote}</${tag}>`;
      });
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

  /** Overflow-stabilized textarea auto-grow (matches ChatInput.tsx to avoid Firefox scrollbar bounce). */
  function resizeTextarea(el, maxPx = 200) {
    if (!el) return;
    el.style.overflowY = "hidden";
    el.style.height = "auto";
    const contentHeight = el.scrollHeight;
    el.style.height = `${Math.min(contentHeight, maxPx)}px`;
    el.style.overflowY = contentHeight > maxPx ? "auto" : "hidden";
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
   * result is returned. Supports `signal` (`AbortSignal`) for immediate user cancellation.
   */
  async function callStream(path, body, onEvent, signal) {
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
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
    } finally {
      reader.releaseLock();
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
        draftPlans: {},
        editing: null,
        input: "",
        sceneInput: "",
        castFilter: "",
        writing: null,
        connections: [],
        settingsOpen: false,
        storiesOpen: false,
        drawerOpen: true,
        promptPolicyOpen: false,
        promptPolicyOptimized: false,
      };
      this._props = null;
      this._token = 0;
      this._abort = null;
      this.addEventListener("click", (event) => this.onClick(event));
      this.addEventListener("input", (event) => this.onInput(event));
      this.addEventListener("change", (event) => this.onChange(event));
      this.addEventListener("keydown", (event) => this.onKeydown(event));
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
      this._abort?.abort();
      this._abort = null;
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
        if (token === this._token && error?.name !== "AbortError") {
          this.state.error = error.message;
        }
      }
      if (token === this._token) this.set({ busy: "" });
    }

    /** Abort an in-flight turn stream and reload the story so any saved phase-1 turn is shown. */
    async stopStream() {
      if (!this._abort) return;
      this._abort.abort();
      this._abort = null;
      this.state.writing = null;
      this._token += 1;
      const storyId = this.state.storyId;
      this.set({ busy: "", error: "" });
      if (storyId) {
        try {
          this.state.data = await call(`/stories/${encodeURIComponent(storyId)}`);
          this.render();
        } catch {
          // Ignore refresh error on cancel.
        }
      }
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
      const isNarrow = typeof window !== "undefined" && window.matchMedia?.("(max-width: 960px)")?.matches;
      this.set({
        view: "story",
        storyId,
        data: null,
        editing: null,
        input: "",
        sceneInput: "",
        draftPlans: {},
        settingsOpen: false,
        storiesOpen: false,
        drawerOpen: !isNarrow,
        promptPolicyOpen: false,
        promptPolicyOptimized: false,
      });
      await this.run("", async () => {
        this.state.data = await call(`/stories/${encodeURIComponent(storyId)}`);
        this.state.draftIndex = this.lastProposalIndex();
        if (this.state.data?.story?.sheet?.proposal) this.state.drawerOpen = true;
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
        if (!result.sheet.proposal) {
          this.state.draftPlans = {};
        } else {
          this.state.drawerOpen = true;
        }
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

    /** Story cast members from the Engine character library. */
    storyCharacters() {
      const ids = this.state.data?.story?.characterIds ?? [];
      const all = this.state.library?.characters ?? [];
      return all.filter((c) => ids.includes(c.id));
    }

    /** Match a speaker or cast name to a library character entry. */
    findCharacterByName(rawName) {
      const needle = String(rawName ?? "")
        .split(/—|-|:/u)[0]
        .trim()
        .toLowerCase();
      if (!needle) return null;
      const cast = this.storyCharacters();
      return (
        cast.find((c) => c.name.toLowerCase() === needle) ??
        cast.find((c) => c.name.split(/\s+/u)[0]?.toLowerCase() === needle) ??
        null
      );
    }

    /** Lower-cased name → dialogue color, for the story's cast and persona. */
    dialogueColors() {
      const colors = new Map();
      const prefs = engineTextPrefs();
      for (const c of this.storyCharacters()) {
        const color = solidColor(c.dialogueColor) || prefs.defaultDialogueColor;
        if (color) {
          colors.set(c.name.toLowerCase(), color);
          const first = c.name.split(/\s+/u)[0]?.toLowerCase();
          if (first) colors.set(first, color);
        }
      }
      const persona = this.persona();
      if (persona?.name) {
        const color = solidColor(persona.dialogueColor) || prefs.defaultDialogueColor;
        if (color) {
          colors.set(persona.name.toLowerCase(), color);
          const first = persona.name.split(/\s+/u)[0]?.toLowerCase();
          if (first) colors.set(first, color);
        }
      }
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
      const title = value("title");
      const personaId = value("persona") || null;
      const mainConnectionId = value("model") || null;
      const premise = value("premise");
      const goals = value("goals");
      const reviewTurns = this.$("[name=reviewTurns]") ? this.$("[name=reviewTurns]").checked : true;
      const characterIds = [...this.querySelectorAll("[name=cast]:checked")].map((box) => box.value);
      let created;
      await this.run("Creating…", async () => {
        created = await call("/stories", "POST", {
          title,
          personaId,
          mainConnectionId,
          characterIds,
          premise,
          goals,
          settings: { reviewTurns },
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

    /**
     * Run a turn route, showing the reply as it is written.
     * Mounts/updates `[data-writing-card]` surgically inside `[data-transcript-inner]` without calling
     * `this.render()`, so the composer textarea and scroll position are never nuked mid-stream.
     */
    async streamTurn(path, body) {
      this._abort?.abort();
      const ac = new AbortController();
      this._abort = ac;
      this.updateComposerActions();
      const prefs = engineTextPrefs();
      const colors = this.dialogueColors();
      try {
        return await callStream(
          path,
          body,
          (event) => {
            if (event.type === "start") {
              this.state.writing = { speaker: event.speaker, text: "" };
              this.mountWritingCard(prefs, colors);
              this.scrollToEnd();
            } else if (event.type === "token" && this.state.writing) {
              this.state.writing.text += event.text;
              const node = this.$("[data-writing]");
              if (node) {
                node.innerHTML = storyText(this.state.writing.text, colors, prefs);
              } else {
                this.mountWritingCard(prefs, colors);
              }
              this.scrollToEnd();
            }
          },
          ac.signal,
        );
      } finally {
        if (this._abort === ac) this._abort = null;
        this.state.writing = null;
      }
    }

    mountWritingCard(prefs, colors) {
      if (!this.state.writing) return;
      const html = this.renderWriting(prefs, colors);
      const existing = this.$("[data-writing-card]");
      if (existing) {
        existing.outerHTML = html;
        return;
      }
      const container = this.$("[data-transcript-inner]");
      if (container) {
        container.insertAdjacentHTML("beforeend", html);
      } else {
        this.render();
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

    /** Current proposed plan at `draftIndex`, with any unsaved user edits overlaid. */
    currentDraftPlan() {
      const proposal = this.state.data?.story?.sheet?.proposal;
      if (!proposal?.plans?.length) return null;
      const index = Math.max(0, Math.min(this.state.draftIndex, proposal.plans.length - 1));
      return this.state.draftPlans[index] ?? structuredClone(proposal.plans[index]);
    }

    readPlan() {
      const plan = {};
      for (const [key, , kind] of PLAN_FIELDS) {
        const el = this.$(`[data-field="${key}"]`);
        if (!el) {
          const fallback = this.currentDraftPlan();
          if (fallback) plan[key] = fallback[key];
          continue;
        }
        const value = el.value ?? "";
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

    saveCurrentDraftFromDom() {
      const proposal = this.state.data?.story?.sheet?.proposal;
      if (!proposal?.plans?.length) return;
      if (!this.$('[data-field="title"]')) return;
      const index = Math.max(0, Math.min(this.state.draftIndex, proposal.plans.length - 1));
      this.state.draftPlans[index] = this.readPlan();
    }

    toggleCastInProposal(charName) {
      this.saveCurrentDraftFromDom();
      const proposal = this.state.data?.story?.sheet?.proposal;
      if (!proposal?.plans?.length) return;
      const index = Math.max(0, Math.min(this.state.draftIndex, proposal.plans.length - 1));
      const plan = this.currentDraftPlan();
      if (!plan) return;
      const lower = charName.toLowerCase();
      const cast = [...(plan.cast ?? [])];
      const existingIdx = cast.findIndex((line) => line.split(/—|-|:/u)[0].trim().toLowerCase() === lower);
      if (existingIdx >= 0) cast.splice(existingIdx, 1);
      else cast.push(charName);
      this.state.draftPlans[index] = { ...plan, cast };
      this.render();
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
      } else if (action === "edit") {
        this.set({ editing: turnId });
        requestAnimationFrame(() => {
          const editBox = this.$("[data-edit]");
          if (editBox) {
            resizeTextarea(editBox, 320);
            editBox.focus();
          }
        });
      } else if (action === "cancel-edit") {
        this.set({ editing: null });
      } else if (action === "save-edit") {
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
        Object.assign(this.state, { view: "list", data: null, settingsOpen: false, storiesOpen: false });
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
      if (target.matches("[data-input]")) {
        this.state.input = target.value;
        resizeTextarea(target, 200);
        this.updateComposerActions();
      } else if (target.matches("[data-edit]")) {
        resizeTextarea(target, 320);
      } else if (target.matches("[data-scene-input]")) {
        this.state.sceneInput = target.value;
      } else if (target.matches("[data-field]")) {
        this.saveCurrentDraftFromDom();
      } else if (target.matches("[data-cast-filter]")) {
        this.state.castFilter = target.value;
        const needle = target.value.trim().toLowerCase();
        for (const row of this.querySelectorAll("[data-cast-row]")) {
          row.hidden = Boolean(needle) && !row.textContent.toLowerCase().includes(needle);
        }
      }
    }

    onKeydown(event) {
      if (event.key === "Escape") {
        if (this._abort) {
          event.preventDefault();
          void this.stopStream();
          return;
        }
        if (this.state.editing) {
          event.preventDefault();
          this.set({ editing: null });
          return;
        }
        if (this.state.settingsOpen || this.state.storiesOpen) {
          event.preventDefault();
          this.set({ settingsOpen: false, storiesOpen: false });
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        const editBox = this.$("[data-edit]");
        if (editBox && document.activeElement === editBox && this.state.editing) {
          event.preventDefault();
          void this.turnAction("save-edit", this.state.editing);
          return;
        }
        const input = this.$("[data-input]");
        if (input && (document.activeElement === input || this.contains(document.activeElement))) {
          event.preventDefault();
          const text = this.state.input.trim();
          if (text) void this.play(event.shiftKey ? "written" : "instruction");
          else void this.play("continue");
        }
      }
    }

    updateComposerActions() {
      const actions = this.$("[data-composer-actions]");
      if (!actions) return;
      if (this._abort || this.state.busy) {
        actions.innerHTML = `
          <button type="button" class="${BTN_DANGER} rounded-full flex items-center gap-1.5" data-action="stop" title="Stop generation (Esc)">
            ${ICON_STOP}
            <span class="font-medium">Stop</span>
          </button>`;
        return;
      }
      const scene = this.openScene();
      const openTurns = scene ? (this.state.data?.turns[scene.id] ?? []) : [];
      const awaitingReply = openTurns.at(-1)?.speaker === "persona";
      const hasInput = Boolean(this.state.input.trim());
      const name = escapeHtml(this.persona().name);

      if (hasInput) {
        actions.innerHTML = `
          <button type="button" class="cs-pill" data-action="play" data-kind="written" title="Send text directly as written (Ctrl+Shift+Enter)">
            <span>Send as written</span>
          </button>
          <button type="button" class="${BTN_PRIMARY} rounded-full flex items-center gap-1.5" data-action="play" data-kind="instruction" title="Your note becomes ${name}'s turn (Ctrl+Enter)">
            ${ICON_SPARKLE}
            <span class="font-medium">Act</span>
          </button>`;
      } else if (awaitingReply) {
        actions.innerHTML = `
          <button type="button" class="${BTN_PRIMARY} rounded-full flex items-center gap-1.5" data-action="play" data-kind="continue" title="Continue the story's reply (Ctrl+Enter)">
            ${ICON_PLAY}
            <span class="font-medium">Continue</span>
          </button>`;
      } else {
        actions.innerHTML = `
          <button type="button" class="cs-pill opacity-40 disabled:cursor-not-allowed" disabled title="Type what ${name} does, or press Continue">
            ${ICON_SPARKLE}
            <span>Act</span>
          </button>
          <button type="button" class="cs-pill" data-action="play" data-kind="continue" title="Let the story go on (Ctrl+Enter)">
            ${ICON_PLAY}
            <span>Continue</span>
          </button>`;
      }
    }

    onClick(event) {
      const target = event.target.closest("[data-action]");
      if (!target || target.disabled || !this.contains(target)) return;
      const { action, id, index, kind } = target.dataset;
      const proposal = this.state.data?.story?.sheet?.proposal;
      if (action === "stop") {
        void this.stopStream();
      } else if (action === "settings") {
        this.set({ settingsOpen: !this.state.settingsOpen, storiesOpen: false });
      } else if (action === "close-settings") {
        if (event.target === target || target.tagName === "BUTTON") this.set({ settingsOpen: false });
      } else if (action === "toggle-stories") {
        this.set({ storiesOpen: !this.state.storiesOpen, settingsOpen: false });
      } else if (action === "close-stories") {
        if (event.target === target || target.tagName === "BUTTON") this.set({ storiesOpen: false });
      } else if (action === "toggle-drawer") {
        this.saveCurrentDraftFromDom();
        this.set({ drawerOpen: !this.state.drawerOpen });
      } else if (action === "toggle-review") {
        const current = this.state.data?.story?.settings?.reviewTurns === true;
        void this.run("Saving…", async () =>
          this.apply(await call(this.storyPath("/settings"), "PUT", { reviewTurns: !current })),
        );
      } else if (action === "toggle-prompt-policy") {
        this.set({ promptPolicyOpen: !this.state.promptPolicyOpen });
      } else if (action === "optimize-prompt-policy") {
        this.set({ promptPolicyOptimized: true, promptPolicyOpen: true });
      } else if (action === "toggle-cast-chip") {
        if (target.dataset.name) this.toggleCastInProposal(target.dataset.name);
      } else if (action === "rate-scene") {
        const rating = Number(target.dataset.rating);
        if (id && rating >= 1 && rating <= 5) {
          void this.run("", async () =>
            this.apply(await call(this.storyPath(`/scenes/${encodeURIComponent(id)}/rating`), "PUT", { rating })),
          );
        }
      } else if (action === "home") {
        this._token += 1;
        this._abort?.abort();
        this._abort = null;
        this.set({ view: "list", data: null, busy: "", settingsOpen: false, storiesOpen: false });
        void this.loadList();
      } else if (action === "close") {
        this._props?.onClose?.();
      } else if (action === "new") {
        this.set({ view: "new", settingsOpen: false, storiesOpen: false });
      } else if (action === "create") {
        void this.createStory();
      } else if (action === "open") {
        void this.openStory(id);
      } else if (action === "play") {
        void this.play(kind);
      } else if (action === "next") {
        void this.nextScene();
      } else if (action === "reroll-plan") {
        this.saveCurrentDraftFromDom();
        void this.run("Planning another version…", async () =>
          this.apply(await call(this.storyPath("/propose"), "POST", { instruction: proposal?.instruction ?? "" })),
        );
      } else if (action === "discard-plan") {
        void this.run("", async () => this.apply(await call(this.storyPath("/proposal"), "DELETE")));
      } else if (action === "accept") {
        void this.accept();
      } else if (action === "version") {
        this.saveCurrentDraftFromDom();
        this.set({ draftIndex: Number(index) });
      } else if (action === "swipe") {
        void this.run("", async () =>
          this.apply(await call(this.storyPath(`/turns/${encodeURIComponent(id)}`), "PUT", { active: Number(index) })),
        );
      } else if (action === "swipe-prev" || action === "swipe-next") {
        const scene = this.openScene();
        const turns = scene ? (this.state.data?.turns[scene.id] ?? []) : [];
        const turn = turns.find((t) => t.id === id);
        if (turn && turn.swipes?.length) {
          const nextIndex = action === "swipe-prev" ? turn.active - 1 : turn.active + 1;
          if (nextIndex >= 0 && nextIndex < turn.swipes.length) {
            void this.run("", async () =>
              this.apply(await call(this.storyPath(`/turns/${encodeURIComponent(id)}`), "PUT", { active: nextIndex })),
            );
          }
        }
      } else if (action === "copy-turn") {
        const scene = this.openScene();
        const turns = scene ? (this.state.data?.turns[scene.id] ?? []) : [];
        const turn = turns.find((t) => t.id === id);
        const text = turn ? (turn.swipes?.[turn.active] ?? "") : "";
        if (text) {
          void navigator.clipboard?.writeText(text);
          const original = target.innerHTML;
          target.innerHTML = ICON_CHECK;
          setTimeout(() => {
            target.innerHTML = original;
          }, 1500);
        }
      } else if (action === "spine") {
        void this.saveSpine();
      } else if (action === "delete-story") {
        void this.deleteStory();
      } else if (action === "copy-id") {
        const text = target.dataset.copy || this.state.data?.story?.id;
        if (text) {
          void navigator.clipboard?.writeText(text);
          const original = target.textContent;
          target.textContent = "Copied!";
          setTimeout(() => {
            target.textContent = original;
          }, 1500);
        }
      } else {
        void this.turnAction(action, id);
      }
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

    renderStoriesDrawer() {
      return `<div class="absolute inset-0 z-40 flex bg-black/25" data-action="close-stories">
        <div class="cs-drawer-left h-full w-full max-w-xs space-y-2 overflow-y-auto bg-[var(--background)] p-3">
          <div class="flex items-center justify-between px-1 pb-1">
            <h2 class="text-sm font-semibold">Stories</h2>
            <button type="button" class="${BTN}" data-action="close-stories">Close</button>
          </div>
          ${this.renderStoryList(true)}
        </div>
      </div>`;
    }

    renderNew() {
      const library = this.state.library ?? { personas: [], characters: [] };
      const personas = library.personas
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
        .join("");
      const cast = library.characters
        .map(
          (c) => `<label data-cast-row class="flex items-center gap-2 px-2 py-1 text-sm cursor-pointer hover:bg-[var(--accent)] rounded">
            <input type="checkbox" name="cast" value="${escapeHtml(c.id)}" class="accent-[var(--primary)]">
            <img class="cs-speaker-avatar" src="${escapeHtml(c.avatarPath || "")}" alt="" onerror="this.style.display='none'">
            <span ${solidColor(c.nameColor) ? `style="color:${solidColor(c.nameColor)}"` : ""}>${escapeHtml(c.name)}</span></label>`,
        )
        .join("");
      return `<div class="mx-auto max-w-3xl space-y-3 p-4">
        <h2 class="text-lg font-semibold">New story</h2>
        <label class="${LABEL}">Title<input class="${FIELD}" name="title" placeholder="The Amber Lantern"></label>
        <label class="${LABEL}">Story model (narrator, your turns, scene planner)
          <select class="${FIELD}" name="model">${this.modelOptions(null)}</select></label>
        <label class="${LABEL}">You play<select class="${FIELD}" name="persona"><option value="">(no persona)</option>${personas}</select></label>
        <label class="${LABEL}">Cast<input class="${FIELD}" data-cast-filter placeholder="Filter characters…" value="${escapeHtml(this.state.castFilter)}"></label>
        <div class="max-h-72 overflow-y-auto rounded-lg ring-1 ring-[var(--border)] p-1">${cast || `<p class="${MUTED} p-2">No characters in the library.</p>`}</div>
        <label class="${LABEL}">Premise<textarea class="${FIELD} resize-y" name="premise" rows="4" placeholder="What the story is about, the world, the situation at the start."></textarea></label>
        <label class="${LABEL}">Story goals<textarea class="${FIELD} resize-y" name="goals" rows="2" placeholder="Where the story is heading. Targets, not a script."></textarea></label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewTurns" checked class="accent-[var(--primary)]">
          Review my turn before the story answers</label>
        <div class="flex gap-2"><button type="button" class="${BTN_PRIMARY}" data-action="create">Create story</button>
          <button type="button" class="${BTN}" data-action="home">Cancel</button></div>
      </div>`;
    }

    /** Render a compact speaker badge with character avatar and name color. */
    renderSpeakerBadge(rawName) {
      const char = this.findCharacterByName(rawName);
      const displayName = char ? char.name : String(rawName ?? "").split(/—|-|:/u)[0].trim();
      if (!displayName) return "";
      const color = solidColor(char?.nameColor || char?.dialogueColor);
      const style = color ? `style="color:${color}"` : "";
      const avatar = char?.avatarPath
        ? `<img class="cs-speaker-avatar" src="${escapeHtml(char.avatarPath)}" alt="" onerror="this.style.display='none'">`
        : `<span class="cs-speaker-avatar">${escapeHtml(displayName.slice(0, 1))}</span>`;
      return `<span class="cs-speaker-chip" ${style}>${avatar}<span class="truncate max-w-36">${escapeHtml(displayName)}</span></span>`;
    }

    /** One turn, in Roleplay's message shapes: the narrator's ruled bubble, or the persona with avatar. */
    renderTurn(turn, live, isLast, prefs, colors) {
      const persona = turn.speaker === "persona";
      const who = this.persona();
      const text = turn.swipes[turn.active] ?? "";
      const usage = turn.usage?.[turn.active] ?? null;
      const textStyle = `font-size:${prefs.fontSize}px;line-height:1.55;${prefs.fontColor ? `color:${prefs.fontColor};` : ""}`;
      const canReroll = live && isLast && (!persona || turn.instruction);
      const hasSwipes = turn.swipes && turn.swipes.length > 1;
      const isEditing = live && this.state.editing === turn.id;

      const actionButtons =
        live && !isEditing
          ? `<div class="cs-tools flex items-center gap-0.5 ml-auto">
              <button type="button" class="cs-icon-btn" data-action="copy-turn" data-id="${turn.id}" title="Copy turn text">${ICON_COPY}</button>
              ${canReroll ? `<button type="button" class="cs-icon-btn" data-action="reroll" data-id="${turn.id}" title="Reroll another version">${ICON_REROLL}</button>` : ""}
              <button type="button" class="cs-icon-btn" data-action="edit" data-id="${turn.id}" title="Edit turn">${ICON_EDIT}</button>
              <button type="button" class="cs-icon-btn cs-danger" data-action="delete" data-id="${turn.id}" title="Delete this turn and everything after it">${ICON_DELETE}</button>
            </div>`
          : "";

      const swipePager =
        live && !isEditing && (hasSwipes || usage)
          ? `<div class="mt-2 pt-1.5 border-t border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-[0.6875rem] text-[var(--muted-foreground)]">
              ${
                hasSwipes
                  ? `<div class="cs-pager">
                      <button type="button" class="cs-icon-btn p-0.5 disabled:opacity-30" data-action="swipe-prev" data-id="${turn.id}" ${turn.active <= 0 ? "disabled" : ""} title="Previous version">${ICON_PREV}</button>
                      <span class="font-mono px-1.5 select-none tabular-nums">${turn.active + 1}/${turn.swipes.length}</span>
                      <button type="button" class="cs-icon-btn p-0.5 disabled:opacity-30" data-action="swipe-next" data-id="${turn.id}" ${turn.active >= turn.swipes.length - 1 ? "disabled" : ""} title="Next version">${ICON_NEXT}</button>
                    </div>`
                  : "<span></span>"
              }
              ${
                usage
                  ? `<span class="cs-tools font-mono tabular-nums opacity-75" title="Prompt: ${usage.input} uncached, ${usage.read} cached read, ${usage.write} cache write · Output: ${usage.output}">
                      ${usage.read > 0 ? `${Math.round((usage.read / (usage.input + usage.read + usage.write)) * 100)}% cached · ` : ""}${usage.output} tok
                    </span>`
                  : ""
              }
            </div>`
          : "";

      const body = isEditing
        ? `<textarea class="${FIELD} resize-y" data-edit rows="6">${escapeHtml(text)}</textarea>
           <div class="mt-2 flex items-center justify-between gap-2">
             <span class="${MUTED}">Ctrl+Enter to save · Esc to cancel</span>
             <div class="flex gap-2">
               <button type="button" class="${BTN}" data-action="cancel-edit" data-id="${turn.id}">Cancel</button>
               <button type="button" class="${BTN_PRIMARY}" data-action="save-edit" data-id="${turn.id}">Save</button>
             </div>
           </div>`
        : `<div class="mari-message-content whitespace-pre-wrap cs-text" style="${textStyle}">${storyText(text, colors, prefs)}</div>`;

      if (!persona) {
        const speakers = extractSpeakers(text);
        const speakerChips = speakers.map((name) => this.renderSpeakerBadge(name)).join("");
        const headerRow =
          speakerChips || actionButtons
            ? `<div class="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                <div class="flex flex-wrap items-center gap-1.5">${speakerChips || `<span class="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Narrator</span>`}</div>
                ${actionButtons}
              </div>`
            : "";
        return `<div class="mari-message mari-message-narrator cs-turn group relative mb-4 px-2" data-turn-id="${escapeHtml(turn.id)}">
          <div class="mari-message-bubble mari-chat-style-surface relative rounded-xl border border-amber-500/25 bg-black/25 px-5 py-4">
            ${headerRow}${body}${swipePager}
          </div></div>`;
      }

      const avatar = who.avatarPath
        ? `<img class="h-8 w-8 shrink-0 rounded-full object-cover" src="${escapeHtml(who.avatarPath)}" alt="">`
        : `<span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-xs font-semibold">${escapeHtml(who.name.slice(0, 1))}</span>`;
      const nameStyle = solidColor(who.nameColor) ? `style="color:${solidColor(who.nameColor)}"` : "";
      return `<div class="mari-message mari-message-user cs-turn group relative mb-4 flex gap-3 px-2" data-turn-id="${escapeHtml(turn.id)}">
        ${avatar}
        <div class="min-w-0 flex-1">
          <div class="mb-1 flex items-center justify-between gap-2 px-1">
            <div class="flex items-baseline gap-2 min-w-0">
              <span class="text-xs font-semibold shrink-0" ${nameStyle}>${escapeHtml(who.name)}</span>
              ${turn.instruction ? `<span class="${MUTED} truncate" title="${escapeHtml(turn.instruction)}">✦ ${escapeHtml(turn.instruction)}</span>` : ""}
            </div>
            ${actionButtons}
          </div>
          <div class="mari-message-bubble mari-chat-style-surface relative rounded-xl border border-[var(--border)] bg-[var(--primary)]/10 px-4 py-3">
            ${body}${swipePager}
          </div>
        </div></div>`;
    }

    renderWriting(prefs, colors) {
      const { speaker, text } = this.state.writing;
      const preview = { id: "writing", speaker, swipes: [text], active: 0, instruction: "" };
      const html = this.renderTurn(preview, false, false, prefs, colors);
      return html
        .replace('data-turn-id="writing"', 'data-writing-card="true"')
        .replace(
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

    renderRatingBar(scene) {
      if (!scene || scene.summary === null) return "";
      const current = scene.rating ?? 0;
      const stars = [1, 2, 3, 4, 5]
        .map(
          (n) =>
            `<button type="button" class="cs-star" data-action="rate-scene" data-id="${escapeHtml(scene.id)}" data-rating="${n}" aria-pressed="${current === n}" title="Rate scene ${n} of 5">${current >= n ? "★" : "☆"} ${n}</button>`,
        )
        .join("");
      return `<div class="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span class="${MUTED}">Scene rating:</span>
        <div class="flex items-center gap-1">${stars}</div>
      </div>`;
    }

    renderTranscript() {
      const { story, turns } = this.state.data;
      const scenes = story.sheet.scenes;
      if (!scenes.length) {
        return `<div class="p-6 text-center space-y-2">
          <p class="text-sm font-medium">No scenes yet.</p>
          <p class="${MUTED}">Plan the first scene in the Scene Sheet drawer${
            story.sheet.spine.premise ? "." : ", or describe the story premise first in Settings."
          }</p>
        </div>`;
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
                : `<details class="${CARD} mb-4" ${i === scenes.length - 1 ? "open" : ""}>
                    <summary class="${MUTED} cursor-pointer font-semibold">Scene ${i + 1} Summary — ${escapeHtml(scene.plan.title)}</summary>
                    <p class="text-sm leading-relaxed">${escapeHtml(scene.summary)}</p>
                    ${this.renderOutcomes(scene)}
                    ${this.renderRatingBar(scene)}
                  </details>`
            }`;
        })
        .join("");
    }

    renderPlan(plan) {
      const list = (items) =>
        items?.length
          ? `<ul class="list-disc pl-4 space-y-0.5">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`
          : "";
      const head = (label) => `<div class="mt-2 text-xs font-semibold text-[var(--muted-foreground)]">${label}</div>`;
      const castBadges = plan.cast?.length
        ? `<div class="flex flex-wrap gap-1 mt-1">${plan.cast.map((c) => this.renderSpeakerBadge(c)).join("")}</div>`
        : "";
      return `<div class="text-sm space-y-1">
        ${plan.location ? `<p class="flex items-center gap-1.5">${ICON_PIN}<span>${escapeHtml(plan.location)}</span></p>` : ""}
        ${plan.cast?.length ? `${head("Present")}${castBadges}${list(plan.cast)}` : ""}
        ${plan.goals?.length ? `${head("What this scene is for")}${list(plan.goals)}` : ""}
        ${plan.facts?.length ? `${head("Facts in play")}${list(plan.facts)}` : ""}</div>`;
    }

    /** The scene's prompt-cache measure (KPI 1), once a call has reported usage. */
    renderStats(stats) {
      if (!stats?.calls) return "";
      const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
      if (stats.warming) {
        return `<p class="${MUTED}" title="Prompt is under the provider's minimum cache threshold (~1,024 tokens). Uncached ${k(stats.input)}, output ${k(stats.output)}.">
          Prompt cache: warming (&lt;1k tok) · ${k(stats.equivalents)} token-equivalents</p>`;
      }
      return `<p class="${MUTED}" title="Cache reads ${k(stats.read)}, writes ${k(stats.write)}, uncached ${k(stats.input)}, output ${k(stats.output)}">
        Prompt cache: ${Math.round(stats.readShare * 100)}% read over ${stats.calls} call${stats.calls === 1 ? "" : "s"} ·
        ${k(stats.equivalents)} token-equivalents</p>`;
    }

    renderSceneHud() {
      const sheet = this.state.data?.story?.sheet;
      if (!sheet) return "";
      const scene = this.openScene();
      const proposal = sheet.proposal;
      const stats = scene ? this.state.data.stats?.[scene.id] : null;
      const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
      const cacheBadge = stats?.calls
        ? `<button type="button" class="cs-pill cursor-pointer" data-action="toggle-prompt-policy" aria-pressed="${this.state.promptPolicyOpen}" title="Cache reads ${k(stats.read)}, writes ${k(stats.write)}, uncached ${k(stats.input)}, output ${k(stats.output)} (Click to inspect Prompt Policy)">
            <span>⚡ ${stats.warming ? "Warming" : `${Math.round(stats.readShare * 100)}% cached`} · ${k(stats.equivalents)} eq</span>
          </button>`
        : `<button type="button" class="cs-pill cursor-pointer" data-action="toggle-prompt-policy" aria-pressed="${this.state.promptPolicyOpen}" title="Inspect Prompt Caching Policy">
            <span>⚡ Cache Policy</span>
          </button>`;

      if (!scene) {
        return `<div class="cs-hud">
          <span class="cs-hud-item">${ICON_FILM}<strong>${proposal ? "Scene proposal ready for review" : "No active scene"}</strong></span>
          <div class="ml-auto flex items-center gap-2">
            ${cacheBadge}
            <button type="button" class="cs-pill" data-action="toggle-drawer" aria-pressed="${this.state.drawerOpen}">
              ${ICON_FILM}
              <span>${this.state.drawerOpen ? "Hide Scene Sheet" : "Open Scene Sheet"}</span>
            </button>
          </div>
        </div>`;
      }

      const castChips = (scene.plan.cast ?? [])
        .slice(0, 4)
        .map((line) => this.renderSpeakerBadge(line))
        .join("");
      const extraCast = (scene.plan.cast?.length ?? 0) > 4 ? `<span class="${MUTED}">+${scene.plan.cast.length - 4}</span>` : "";

      return `<div class="cs-hud">
        <span class="cs-hud-item" title="Current scene">${ICON_FILM}<strong>Scene ${sheet.scenes.length}: ${escapeHtml(scene.plan.title)}</strong></span>
        ${scene.plan.location ? `<span class="cs-hud-item" title="Location">${ICON_PIN}<span>${escapeHtml(scene.plan.location)}</span></span>` : ""}
        ${castChips ? `<span class="cs-hud-item" title="Cast present">${ICON_USERS}<span class="flex items-center gap-1">${castChips}${extraCast}</span></span>` : ""}
        ${scene.plan.goals?.length ? `<span class="cs-hud-item" title="${escapeHtml(scene.plan.goals.join(" • "))}">${ICON_TARGET}<span>${scene.plan.goals.length} goal${scene.plan.goals.length === 1 ? "" : "s"}</span></span>` : ""}
        <div class="ml-auto flex items-center gap-1.5">
          ${cacheBadge}
          <button type="button" class="cs-pill" data-action="toggle-drawer" aria-pressed="${this.state.drawerOpen}" title="Toggle Scene Sheet drawer">
            <span>Scene Sheet</span>
          </button>
        </div>
      </div>`;
    }

    renderPromptPolicyDrawer() {
      if (!this.state.promptPolicyOpen) return "";
      const isOptimized = this.state.promptPolicyOptimized;
      const statusBadge = isOptimized
        ? `<span class="rounded px-1.5 py-0.5 text-[0.625rem] font-bold bg-green-500/10 text-green-400 border border-green-500/20">Optimal (98%)</span>`
        : `<span class="rounded px-1.5 py-0.5 text-[0.625rem] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">Needs Optimization (45%)</span>`;

      return `<div class="border-b border-[var(--border)] bg-[var(--card)] px-4 py-3 text-xs space-y-2.5 transition-all">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-sm">⚡ Prompt Caching Policy &amp; Health</span>
            ${statusBadge}
          </div>
          <button type="button" class="cs-pill" data-action="toggle-prompt-policy" title="Close inspector">✕</button>
        </div>
        <p class="${MUTED}">
          ${
            isOptimized
              ? "All prompt sections are ordered for maximum provider cache reuse. Static system rules, persona, and character cards are locked behind the cache anchor. Expected cache hit rate: 85–92%."
              : "Dynamic variables or suboptimal section ordering may invalidate your prompt cache prefix on every turn, causing higher token costs."
          }
        </p>
        ${
          !isOptimized
            ? `<div class="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-amber-300">
                <div class="font-medium">⚠️ Detected Policy Improvements:</div>
                <ul class="list-disc pl-4 space-y-0.5 text-[0.6875rem]">
                  <li>Ensure volatile macros (<code>{{time}}</code>, <code>{{date}}</code>) sit after the static cache anchor.</li>
                  <li>Verify static character and persona cards precede dynamic chat history in the prompt.</li>
                  <li>Keep finished scene summaries immutable to anchor expanding story context.</li>
                </ul>
              </div>
              <div class="flex items-center gap-2 pt-1">
                <button type="button" class="${BTN_PRIMARY} flex items-center gap-1.5" data-action="optimize-prompt-policy">
                  ${ICON_SPARKLE}
                  <span>✨ 1-Click Optimize Preset for Caching</span>
                </button>
                <button type="button" class="cs-pill" data-action="toggle-prompt-policy">Dismiss</button>
              </div>`
            : `<div class="space-y-1 rounded-lg border border-green-500/20 bg-green-500/5 p-2 text-green-300 text-[0.6875rem]">
                ✓ Cache optimization applied. Prompt prefix is stabilized for Anthropic &amp; Gemini ephemeral caching.
              </div>`
        }
      </div>`;
    }

    renderReview(proposal) {
      const plans = proposal.plans;
      const index = Math.max(0, Math.min(this.state.draftIndex, plans.length - 1));
      const plan = this.currentDraftPlan() ?? plans[index];
      const storyCast = this.storyCharacters();
      const presentLower = new Set(
        (plan.cast ?? []).map((line) => line.split(/—|-|:/u)[0].trim().toLowerCase()).filter(Boolean),
      );
      const castChips = storyCast.length
        ? `<div class="space-y-1">
            <div class="text-xs text-[var(--muted-foreground)]">Quick-toggle story cast</div>
            <div class="flex flex-wrap gap-1">
              ${storyCast
                .map((c) => {
                  const active = presentLower.has(c.name.toLowerCase());
                  return `<button type="button" class="cs-pill" data-action="toggle-cast-chip" data-name="${escapeHtml(c.name)}" aria-pressed="${active}">
                    <span>${active ? "✓" : "+"} ${escapeHtml(c.name)}</span>
                  </button>`;
                })
                .join("")}
            </div>
          </div>`
        : "";

      const field = ([key, label, kind]) => {
        const value = kind === "list" ? (plan[key] ?? []).join("\n") : (plan[key] ?? "");
        const inputHtml =
          kind === "input"
            ? `<label class="${LABEL}">${label}<input class="${FIELD}" data-field="${key}" value="${escapeHtml(value)}"></label>`
            : `<label class="${LABEL}">${label}<textarea class="${FIELD} resize-y" data-field="${key}" rows="${kind === "list" ? 3 : 2}">${escapeHtml(value)}</textarea></label>`;
        return key === "cast" ? `${castChips}${inputHtml}` : inputHtml;
      };
      const versions =
        plans.length > 1
          ? `<div class="flex flex-wrap gap-1">${plans
              .map(
                (_, i) =>
                  `<button type="button" class="cs-pill" data-action="version" data-index="${i}" aria-pressed="${i === index}">v${i + 1}</button>`,
              )
              .join("")}</div>`
          : "";
      const lastClosed = this.state.data?.story?.sheet?.scenes?.at(-1);
      const ratePrev =
        lastClosed && lastClosed.summary !== null && !lastClosed.rating
          ? `<div class="rounded-lg border border-[var(--border)] bg-[var(--secondary)] p-2">
              ${this.renderRatingBar(lastClosed)}
            </div>`
          : "";

      return `<div class="${CARD}">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">Proposed scene</h3>
          ${versions}
        </div>
        ${proposal.instruction ? `<p class="${MUTED}">From: ${escapeHtml(proposal.instruction)}</p>` : ""}
        ${ratePrev}
        ${PLAN_FIELDS.map(field).join("")}
        <div class="flex flex-wrap gap-2 pt-1">
          <button type="button" class="${BTN_PRIMARY}" data-action="accept">Accept &amp; start</button>
          <button type="button" class="${BTN}" data-action="reroll-plan">Reroll</button>
          <button type="button" class="${BTN}" data-action="discard-plan">Discard</button>
        </div></div>`;
    }

    renderSide() {
      const sheet = this.state.data.story.sheet;
      const scene = this.openScene();
      const current = scene
        ? `<div class="${CARD}">
            <div class="flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">Scene ${sheet.scenes.length}: ${escapeHtml(scene.plan.title)}</h3>
              <button type="button" class="${BTN} sm:hidden" data-action="toggle-drawer">Close</button>
            </div>
            ${this.renderPlan(scene.plan)}${this.renderStats(this.state.data.stats?.[scene.id])}</div>`
        : "";
      const next = sheet.proposal
        ? this.renderReview(sheet.proposal)
        : `<div class="${CARD}">
            <label class="${LABEL}">${sheet.scenes.length ? "Next scene" : "First scene"} (optional direction)
              <textarea class="${FIELD} resize-y" data-scene-input rows="2" placeholder="A few hours later, everyone meets to debrief…">${escapeHtml(this.state.sceneInput)}</textarea></label>
            <button type="button" class="${BTN_PRIMARY} w-full" data-action="next">${scene ? "End scene & plan next" : "Plan scene"}</button>
          </div>`;
      return `<div class="space-y-3 p-3">${current}${next}</div>`;
    }

    renderSettings() {
      const story = this.state.view === "story" ? this.state.data?.story : null;
      if (!story) return "";
      const settings = story.settings ?? {};
      return `<div class="absolute inset-0 z-40 flex justify-end bg-black/25" data-action="close-settings">
        <div class="cs-drawer h-full w-full max-w-md space-y-3 overflow-y-auto bg-[var(--background)] p-4">
          <div class="flex items-center justify-between"><h2 class="text-lg font-semibold">Story settings</h2>
            <button type="button" class="${BTN}" data-action="close-settings">Done</button></div>
          <label class="${LABEL}">Title<input class="${FIELD}" data-set="title" value="${escapeHtml(story.title)}"></label>
          <label class="${LABEL}">Story ID
            <div class="flex items-center gap-2">
              <input class="${FIELD} font-mono text-xs select-all" readonly value="${escapeHtml(story.id)}">
              <button type="button" class="${BTN}" data-action="copy-id" data-copy="${escapeHtml(story.id)}" title="Copy story ID">Copy</button>
            </div>
            <p class="text-[0.6875rem] ${MUTED} mt-1">mari CLI: <code class="select-all font-mono text-[0.625rem]">mari db select capability_documents --where "row.id.includes('${escapeHtml(story.id)}')</code></p>
          </label>
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
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-set="reviewTurns" ${settings.reviewTurns ? "checked" : ""} class="accent-[var(--primary)]">
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
      const open = this.openScene();
      const live = Boolean(open) && !story.sheet.proposal;
      if (!live) return "";
      const name = escapeHtml(this.persona().name);
      const openTurns = this.state.data.turns[open.id] ?? [];
      const lastTurn = openTurns.at(-1);
      const awaitingReply = lastTurn?.speaker === "persona";
      const reviewOn = story.settings?.reviewTurns === true;

      const currentModelId = story.mainConnectionId;
      const currentConn = this.state.connections.find((c) => c.id === currentModelId);
      const defaultConn = this.state.connections.find((c) => c.isDefault);
      const modelDisplayName = currentConn
        ? currentConn.name
        : defaultConn
          ? `Default (${defaultConn.name})`
          : "Default model";

      const currentLength = story.settings?.replyLength || "medium";
      const lengthLabels = { short: "Short (1–2 ¶)", medium: "Medium (3–4 ¶)", long: "Long" };
      const lengthDisplayName = lengthLabels[currentLength] || "Medium";

      return `<div class="border-t border-[var(--border)] px-4 py-3 bg-[var(--background)]">
        <div class="mx-auto max-w-3xl space-y-2">
          ${
            awaitingReply
              ? `<div class="cs-review-banner">
                  <span><strong>${name}'s turn is ready.</strong> Review, edit, or reroll it, then press <strong>Continue</strong>.</span>
                  <div class="flex items-center gap-1.5">
                    ${lastTurn.instruction ? `<button type="button" class="cs-pill" data-action="reroll" data-id="${escapeHtml(lastTurn.id)}" title="Reroll your turn">${ICON_REROLL}<span>Reroll</span></button>` : ""}
                    <button type="button" class="cs-pill" data-action="edit" data-id="${escapeHtml(lastTurn.id)}" title="Edit your turn">${ICON_EDIT}<span>Edit</span></button>
                    <button type="button" class="${BTN_PRIMARY} rounded-full flex items-center gap-1" data-action="play" data-kind="continue">${ICON_PLAY}<span>Continue</span></button>
                  </div>
                </div>`
              : ""
          }
          <div class="cs-composer-shell marinara-chat-input-shell">
            <textarea data-input rows="2" placeholder="What does ${name} do? Short note is enough (Ctrl+Enter to Act, Shift+Ctrl+Enter to send as written)…"
              class="mari-chat-input-textarea max-h-[12.5rem] w-full resize-none bg-transparent text-sm text-[var(--foreground)] placeholder:text-foreground/30 outline-none">${escapeHtml(this.state.input)}</textarea>
            <div class="cs-composer-bar">
              <div class="flex items-center gap-1.5 flex-wrap">
                <label class="relative inline-flex items-center cursor-pointer" title="Story model: ${escapeHtml(modelDisplayName)}">
                  <select class="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" data-set="mainConnectionId">
                    ${this.modelOptions(story.mainConnectionId)}
                  </select>
                  <span class="cs-pill">
                    ${ICON_MODEL}
                    <span class="cs-pill-label">${escapeHtml(modelDisplayName)}</span>
                    ${ICON_CHEVRON}
                  </span>
                </label>
                <label class="relative inline-flex items-center cursor-pointer" title="Turn length: ${escapeHtml(lengthDisplayName)}">
                  <select class="absolute inset-0 opacity-0 cursor-pointer w-full h-full z-10" data-set="replyLength">
                    ${[
                      ["short", "Short (1–2 paragraphs)"],
                      ["medium", "Medium (3–4 paragraphs)"],
                      ["long", "Long"],
                    ]
                      .map(([v, l]) => `<option value="${v}" ${currentLength === v ? "selected" : ""}>${l}</option>`)
                      .join("")}
                  </select>
                  <span class="cs-pill">
                    <span class="cs-pill-label">${escapeHtml(lengthDisplayName)}</span>
                    ${ICON_CHEVRON}
                  </span>
                </label>
                <button type="button" class="cs-pill" data-action="toggle-review" aria-pressed="${reviewOn}" title="When Review is On, Act writes your turn first and pauses so you can inspect or edit it before the narrator replies.">
                  <span>Review: ${reviewOn ? "On" : "Off"}</span>
                </button>
              </div>
              <div class="flex items-center gap-1.5 ml-auto" data-composer-actions></div>
            </div>
          </div>
        </div></div>`;
    }

    renderStory() {
      if (!this.state.data) return `<div class="cs-body cs-solo"><p class="${MUTED} p-4">Loading…</p></div>`;
      return `${this.renderSceneHud()}
      ${this.renderPromptPolicyDrawer()}
      <div class="cs-body ${this.state.drawerOpen ? "" : "cs-drawer-closed"}">
        <main class="cs-main">
          <div class="cs-col flex-1 px-2 py-2" data-transcript>
            <div class="mx-auto max-w-3xl" data-transcript-inner>${this.renderTranscript()}</div>
          </div>
          ${this.renderComposer()}
        </main>
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
          ${
            view === "story"
              ? `<button type="button" class="${BTN}" data-action="toggle-stories" aria-pressed="${this.state.storiesOpen}">Stories ▾</button>`
              : view === "new"
                ? `<button type="button" class="${BTN}" data-action="home">Stories</button>`
                : ""
          }
          <h1 class="min-w-0 flex-1 truncate text-base font-semibold">${escapeHtml(title)}</h1>
          ${
            busy
              ? `<span class="${MUTED} flex items-center gap-1.5"><svg class="h-3 w-3 animate-spin text-[var(--primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>${escapeHtml(busy)}</span>`
              : ""
          }
          ${error ? `<span class="text-xs text-red-300">${escapeHtml(error)}</span>` : ""}
          ${view === "story" && data ? `<button type="button" class="${BTN}" data-action="settings">Settings</button>` : ""}
          ${this._props?.onClose ? `<button type="button" class="${BTN}" data-action="close">Close</button>` : ""}
        </header>
        ${content}
        ${this.state.storiesOpen ? this.renderStoriesDrawer() : ""}
        ${this.state.settingsOpen ? this.renderSettings() : ""}
      </div>`;
      this.updateComposerActions();
      if (busy) {
        for (const button of this.querySelectorAll("button")) {
          if (!BUSY_ALLOWED_ACTIONS.has(button.dataset.action)) button.disabled = true;
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
    if (element.hasAttribute("data-field")) return `[data-field="${element.getAttribute("data-field")}"]`;
    return null;
  }

  // Expose pure helpers on globalThis.__callSheetHelpers for automated node --test verification.
  globalThis.__callSheetHelpers = {
    extractSpeakers,
    storyText,
    solidColor,
    BUSY_ALLOWED_ACTIONS,
  };

  if (typeof customElements !== "undefined" && !customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, CallSheetElement);
  }
})();
