"use strict";

// Aside: Notes + side chat for one chat. One custom element, three views: `toolbar` (a button that opens the
// panel as a popover), `tracker` (the panel inline) and anything else renders nothing. Plain DOM, drawn with
// the Engine's theme variables.
(() => {
  const TAG = "marinara-capability-aside";
  const API = "/api/aside";
  const MODES = new Set(["roleplay", "game"]);

  const esc = (v) =>
    String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

  function headers(json) {
    const h = { "x-marinara-csrf": "1" };
    try {
      const secret = window.localStorage.getItem("marinara_admin_secret")?.trim();
      if (secret) h["X-Admin-Secret"] = secret;
    } catch {
      /* storage blocked: send without */
    }
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async function request(path, method = "GET", body) {
    const res = await fetch(API + path, {
      method,
      headers: headers(body !== undefined),
      cache: "no-store",
      credentials: "same-origin",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new Error(payload?.error || `Request failed (${res.status})`);
    return payload;
  }

  /**
   * Ask through the Engine's own dryRun: the chat's real prompt plus `userMessage` as a temporary last turn,
   * nothing persisted. `onToken` gets each chunk; the promise resolves to the full answer.
   */
  async function ask(chatId, prepared, onToken, signal) {
    const res = await fetch("/api/generate/dryRun", {
      method: "POST",
      headers: headers(true),
      credentials: "same-origin",
      body: JSON.stringify({
        chatId,
        userMessage: prepared.userMessage,
        streaming: true,
        injectLorebook: true,
        injectTrackers: true,
        injectChatSummary: true,
        ...(prepared.connectionId ? { connectionId: prepared.connectionId } : {}),
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error || `Request failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        const line = raw.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "token") (answer += event.data), onToken(event.data);
        else if (event.type === "result") answer = event.data?.content ?? answer;
        else if (event.type === "error") throw new Error(String(event.data));
      }
    }
    if (!answer.trim()) throw new Error("The model returned an empty reply.");
    return answer;
  }

  const SVG = 'viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const ICON_PIN = (on) => `<svg ${SVG} ${on ? 'fill="currentColor"' : ""}><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3" ${on ? 'fill="var(--background)"' : ""}></circle></svg>`;
  const ICON_EDIT = `<svg ${SVG}><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
  const ICON_TRASH = `<svg ${SVG}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`;
  const ICON_CHECK = `<svg ${SVG}><polyline points="20 6 9 17 4 12"></polyline></svg>`;

  /** Enter submits, Shift+Enter is a newline; Enter while composing text (IME) is left alone. */
  const isSubmit = (e) => e.key === "Enter" && !e.shiftKey && !e.isComposing;

  const CSS = `
    .as-icon { display: inline-flex; align-items: center; gap: .25rem; padding: .25rem; border-radius: .375rem; border: 0; background: transparent; color: var(--muted-foreground); cursor: pointer; font-size: .75rem; }
    .as-icon:hover { background: var(--accent); color: var(--foreground); }
    .as-icon[aria-pressed="true"] { color: var(--primary); }
    .as-icon.as-danger:hover, .as-icon.as-danger[data-confirm="true"] { background: rgba(239,68,68,.15); color: #f87171; }
    .as-card[draggable="true"] { cursor: grab; }
    .as-card.as-dragging { opacity: .4; }
    .as-card.as-over { outline: 2px dashed var(--primary); }
    .as-shell { display: grid; gap: .5rem; font-size: .8125rem; color: var(--foreground); }
    .as-tabs { display: flex; gap: .25rem; }
    .as-tab { padding: .25rem .625rem; border-radius: 9999px; border: 1px solid var(--border); background: var(--secondary); cursor: pointer; font-size: .75rem; color: var(--foreground); }
    .as-tab[aria-pressed="true"] { border-color: var(--primary); background: color-mix(in srgb, var(--primary) 18%, var(--secondary)); }
    .as-field { width: 100%; border-radius: .5rem; background: var(--secondary); color: var(--foreground); padding: .375rem .5rem; border: 1px solid var(--border); font: inherit; resize: vertical; }
    .as-list { display: grid; gap: .375rem; max-height: 22rem; overflow-y: auto; }
    .as-card { border: 1px solid var(--border); background: var(--card); border-radius: .625rem; padding: .375rem .5rem; display: grid; gap: .25rem; }
    .as-card[data-pinned="true"] { border-color: var(--primary); }
    .as-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .as-row { display: flex; gap: .375rem; flex-wrap: wrap; align-items: center; }
    .as-muted { color: var(--muted-foreground); font-size: .75rem; }
    .as-q { background: var(--secondary); }
    .as-error { color: #f87171; font-size: .75rem; }
    .as-pop { position: absolute; right: 0; top: 100%; z-index: 60; width: min(24rem, 92vw); padding: .625rem; border-radius: .75rem; border: 1px solid var(--border); background: var(--background); box-shadow: 0 8px 24px rgba(0,0,0,.35); }
    .as-anchor { position: relative; display: inline-block; }
  `;

  class AsideElement extends HTMLElement {
    static observedAttributes = ["view"];

    constructor() {
      super();
      this.state = { editId: null, editText: "", confirmDel: null, dragId: null, tab: "notes", open: false, data: null, chatId: null, busy: false, draft: "", error: "", streaming: "", search: "", settings: false, question: "" };
    }

    get props() {
      return this.capabilityProps ?? {};
    }

    connectedCallback() {
      this.addEventListener("marinara-capability-props", () => this.sync());
      this.sync();
    }

    disconnectedCallback() {
      this.abort?.abort();
    }

    attributeChangedCallback(name, oldValue, newValue) {
      if (name === "view" && oldValue !== newValue && this.isConnected) this.render();
    }

    /** Reload when the chat changes. */
    sync() {
      const chatId = this.props.chatId || null;
      if (chatId !== this.state.chatId) {
        this.state = { ...this.state, chatId, data: null, error: "", streaming: "" };
        if (chatId && this.shown()) void this.load();
      }
      this.render();
    }

    shown() {
      return this.getAttribute("view") === "tracker" || this.state.open;
    }

    async load() {
      const chatId = this.state.chatId;
      try {
        const data = await request(`/chats/${encodeURIComponent(chatId)}`);
        if (chatId === this.state.chatId) this.state.data = data;
        this.state.error = "";
      } catch (error) {
        this.state.error = error.message;
      }
      this.render();
    }

    async run(work) {
      try {
        this.state.data = await work();
        this.state.error = "";
      } catch (error) {
        this.state.error = error.message;
      }
      this.render();
    }

    render() {
      const view = this.getAttribute("view");
      const enabled = MODES.has(this.props.chatMode) && this.state.chatId;
      if (!enabled || (view !== "toolbar" && view !== "tracker")) return void (this.innerHTML = "");
      if (view === "toolbar") {
        const cls = this.props.toolbarButtonClass ?? "mari-chrome-control mari-chrome-control--small";
        this.innerHTML = `<style>${CSS}</style><span class="as-anchor"><button type="button" class="${esc(cls)}" data-act="toggle" aria-expanded="${this.state.open}" title="Aside">Aside</button>${this.state.open ? `<div class="as-pop">${this.panel()}</div>` : ""}</span>`;
      } else {
        this.innerHTML = `<style>${CSS}</style>${this.panel()}`;
      }
      this.bind();
    }

    panel() {
      const s = this.state;
      if (!s.data) return `<div class="as-shell as-muted">${s.error ? `<span class="as-error">${esc(s.error)}</span>` : "Loading…"}</div>`;
      const tab = (id, label) => `<button type="button" class="as-tab" data-act="tab" data-tab="${id}" aria-pressed="${s.tab === id}">${label}</button>`;
      return `<div class="as-shell"><div class="as-tabs">${tab("notes", "Notes")}${tab("aside", "Side chat")}</div>${s.tab === "notes" ? this.notes() : this.aside()}${s.error ? `<div class="as-error">${esc(s.error)}</div>` : ""}</div>`;
    }

    notes() {
      const { data, draft, search } = this.state;
      const q = search.trim().toLowerCase();
      const list = data.notes.filter((n) => !q || n.text.toLowerCase().includes(q));
      const drag = !q; // dragging reorders the whole list, so it is off while a search hides notes
      const cards = list
        .map((n) => {
          const confirm = this.state.confirmDel === n.id;
          const editing = this.state.editId === n.id;
          const body = editing
            ? `<textarea class="as-field" data-edit="${esc(n.id)}" rows="3">${esc(this.state.editText)}</textarea><div class="as-muted">Enter to save, Shift+Enter for a new line, Esc to cancel</div>`
            : `<div class="as-text" data-dbl="${esc(n.id)}" title="Double-click to edit">${esc(n.text)}</div>`;
          return `<div class="as-card" data-pinned="${n.pinned}" data-id="${esc(n.id)}" ${drag && !editing ? 'draggable="true"' : ""}>${body}<div class="as-row"><button type="button" class="as-icon" data-act="pin" data-id="${esc(n.id)}" aria-pressed="${n.pinned}" title="${n.pinned ? "Unpin" : "Pin"}" aria-label="${n.pinned ? "Unpin" : "Pin"}">${ICON_PIN(n.pinned)}</button><button type="button" class="as-icon" data-act="edit" data-id="${esc(n.id)}" title="Edit" aria-label="Edit">${ICON_EDIT}</button><button type="button" class="as-icon as-danger" data-act="del" data-id="${esc(n.id)}" data-confirm="${confirm}" title="${confirm ? "Click again to delete" : "Delete"}" aria-label="${confirm ? "Click again to delete" : "Delete"}">${confirm ? `${ICON_CHECK}Delete?` : ICON_TRASH}</button>${n.source === "aside" ? '<span class="as-muted">from side chat</span>' : ""}</div></div>`;
        })
        .join("");
      return `<textarea class="as-field" data-field="draft" rows="2" placeholder="New note (Enter to add, Shift+Enter for a new line)">${esc(draft)}</textarea><div class="as-row"><button type="button" class="as-tab" data-act="add">Add note</button><input class="as-field" data-field="search" placeholder="Search" value="${esc(search)}" style="flex:1;width:auto"><select class="as-field" data-sort style="width:auto" aria-label="Sort notes" title="Reorder once; drag to fine-tune"><option value="">Sort…</option><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="alpha">A to Z</option><option value="pinned">Pinned first</option></select></div><div class="as-list">${cards || '<span class="as-muted">No notes yet.</span>'}</div><div class="as-muted">Drag notes to reorder. Pinned notes are shown to the narrator in side-chat questions.</div>`;
    }

    aside() {
      const { data, busy, streaming, question, settings } = this.state;
      const turns = data.thread
        .map((t) => {
          const editing = this.state.editId === t.id;
          const confirm = this.state.confirmDel === t.id;
          const body = editing
            ? `<textarea class="as-field" data-edit="${esc(t.id)}" rows="3">${esc(this.state.editText)}</textarea><div class="as-muted">Enter to save, Shift+Enter for a new line, Esc to cancel</div>`
            : `<div class="as-text" data-dbl="${esc(t.id)}" title="Double-click to edit">${esc(t.text)}</div>`;
          const save = t.role === "assistant" ? `<button type="button" class="as-tab" data-act="save" data-id="${esc(t.id)}">Save as note</button>` : "";
          const tools = `<div class="as-row"><button type="button" class="as-icon" data-act="edit" data-id="${esc(t.id)}" title="Edit" aria-label="Edit">${ICON_EDIT}</button><button type="button" class="as-icon as-danger" data-act="del" data-id="${esc(t.id)}" data-confirm="${confirm}" title="${confirm ? "Click again to delete" : "Delete"}" aria-label="${confirm ? "Click again to delete" : "Delete"}">${confirm ? `${ICON_CHECK}Delete?` : ICON_TRASH}</button>${save}</div>`;
          return `<div class="as-card ${t.role === "user" ? "as-q" : ""}"><div class="as-muted">${t.role === "user" ? "You" : "Narrator"}</div>${body}${tools}</div>`;
        })
        .join("");
      const live = busy ? `<div class="as-card"><div class="as-muted">Narrator</div><div class="as-text">${esc(streaming) || "…"}</div></div>` : "";
      const s = data.settings;
      const num = (key, label) => `<label class="as-muted">${label}<input class="as-field" type="number" data-setting="${key}" value="${s[key]}"></label>`;
      const config = settings
        ? `<div class="as-card">${num("threadTurns", "Side-chat turns kept")}<label class="as-muted">Connection id (empty = this chat's)<input class="as-field" data-setting="connectionId" value="${esc(s.connectionId ?? "")}"></label><button type="button" class="as-tab" data-act="save-settings">Save settings</button></div>`
        : "";
      return `<div class="as-list">${turns || '<span class="as-muted">Ask the narrator something out of character. Nothing is added to the story.</span>'}${live}</div><textarea class="as-field" data-field="question" rows="2" placeholder="Ask the narrator… (Enter to send, Shift+Enter for a new line)" ${busy ? "disabled" : ""}>${esc(question)}</textarea><div class="as-row"><button type="button" class="as-tab" data-act="${busy ? "stop" : "ask"}">${busy ? "Stop" : "Ask"}</button><button type="button" class="as-tab" data-act="clear" ${busy ? "disabled" : ""}>Clear thread</button><button type="button" class="as-tab" data-act="settings">Settings</button></div>${config}`;
    }

    bind() {
      for (const el of this.querySelectorAll("[data-field]")) {
        el.addEventListener("input", () => {
          this.state[el.dataset.field] = el.value;
          if (el.dataset.field === "search") this.render(), this.querySelector("[data-field=search]")?.focus();
        });
      }
      this.bindDrag();
      this.bindEdit();
      for (const [field, action] of [["draft", "add"], ["question", "ask"]]) {
        this.querySelector(`[data-field=${field}]`)?.addEventListener("keydown", (e) => {
          if (isSubmit(e)) (e.preventDefault(), this.act(action, {}));
        });
      }
      this.querySelector("[data-sort]")?.addEventListener("change", (e) => {
        const sort = e.target.value;
        e.target.value = "";
        if (!sort) return;
        const base = `/chats/${encodeURIComponent(this.state.chatId)}`;
        void this.run(() => request(`${base}/notes-order`, "PUT", { sort }).then(() => request(base)));
      });
      for (const el of this.querySelectorAll("[data-act]")) el.addEventListener("click", () => this.act(el.dataset.act, el.dataset));
    }

    /** A note or a side-thread turn by id (ids are unique across both) and the route segment it lives under. */
    item(id) {
      const { notes, thread } = this.state.data;
      return notes.find((n) => n.id === id) ?? thread.find((t) => t.id === id) ?? null;
    }

    segment(id) {
      return this.state.data.notes.some((n) => n.id === id) ? "notes" : "thread";
    }

    startEdit(id) {
      const item = this.item(id);
      if (!item) return;
      Object.assign(this.state, { editId: id, editText: item.text });
      this.render();
      this.querySelector("[data-edit]")?.focus();
    }

    /** Double-click a note to edit it in place. Ctrl/Cmd+Enter or leaving the box saves; Esc cancels. */
    bindEdit() {
      for (const el of this.querySelectorAll("[data-dbl]")) el.addEventListener("dblclick", () => this.startEdit(el.dataset.dbl));
      const box = this.querySelector("[data-edit]");
      if (!box) return;
      const finish = (save) => {
        const { editId, editText, chatId } = this.state;
        if (editId === null) return;
        this.state.editId = null;
        const text = editText.trim();
        if (!save || !text || text === this.item(editId)?.text) return this.render();
        const base = `/chats/${encodeURIComponent(chatId)}`;
        void this.run(() => request(`${base}/${this.segment(editId)}/${editId}`, "PUT", { text }).then(() => request(base)));
      };
      box.addEventListener("input", () => (this.state.editText = box.value));
      box.addEventListener("keydown", (e) => {
        if (e.key === "Escape") finish(false);
        else if (isSubmit(e)) (e.preventDefault(), finish(true));
      });
      box.addEventListener("blur", () => finish(true));
    }

    /** Drag a note onto another to move it there. No re-render until the drop, so the drag survives. */
    bindDrag() {
      const cards = [...this.querySelectorAll(".as-card[draggable=true]")];
      for (const card of cards) {
        card.addEventListener("dragstart", (e) => {
          this.state.dragId = card.dataset.id;
          card.classList.add("as-dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.dataset.id);
        });
        card.addEventListener("dragend", () => {
          this.state.dragId = null;
          for (const c of cards) c.classList.remove("as-dragging", "as-over");
        });
        card.addEventListener("dragover", (e) => {
          if (!this.state.dragId || this.state.dragId === card.dataset.id) return;
          e.preventDefault();
          card.classList.add("as-over");
        });
        card.addEventListener("dragleave", () => card.classList.remove("as-over"));
        card.addEventListener("drop", (e) => {
          e.preventDefault();
          const from = this.state.dragId;
          this.state.dragId = null;
          if (!from || from === card.dataset.id) return this.render();
          const ids = this.state.data.notes.map((n) => n.id).filter((id) => id !== from);
          ids.splice(ids.indexOf(card.dataset.id), 0, from);
          const byId = new Map(this.state.data.notes.map((n) => [n.id, n]));
          this.state.data = { ...this.state.data, notes: ids.map((id) => byId.get(id)) };
          this.render();
          const base = `/chats/${encodeURIComponent(this.state.chatId)}`;
          void this.run(() => request(`${base}/notes-order`, "PUT", { ids }).then(() => request(base)));
        });
      }
    }

    act(action, ds) {
      const s = this.state;
      // Delete takes two clicks; any other click cancels a pending confirmation.
      if (action === "del") {
        if (s.confirmDel !== ds.id) return void ((s.confirmDel = ds.id), this.render());
        s.confirmDel = null;
      } else s.confirmDel = null;
      const base = `/chats/${encodeURIComponent(s.chatId)}`;
      if (action === "toggle") {
        s.open = !s.open;
        if (s.open && !s.data) void this.load();
        return this.render();
      }
      if (action === "tab") return void ((s.tab = ds.tab), this.render());
      if (action === "settings") return void ((s.settings = !s.settings), this.render());
      if (action === "add") {
        const text = s.draft;
        if (!text.trim()) return;
        s.draft = "";
        return void this.run(() => request(`${base}/notes`, "POST", { text }).then(() => request(base))).then(() =>
          this.querySelector("[data-field=draft]")?.focus(),
        );
      }
      if (action === "pin") {
        const note = s.data.notes.find((n) => n.id === ds.id);
        return void this.run(() => request(`${base}/notes/${ds.id}`, "PUT", { pinned: !note?.pinned }).then(() => request(base)));
      }
      if (action === "edit") return void this.startEdit(ds.id);
      if (action === "del") return void this.run(() => request(`${base}/${this.segment(ds.id)}/${ds.id}`, "DELETE").then(() => request(base)));
      if (action === "save") {
        const turn = s.data.thread.find((t) => t.id === ds.id);
        return void this.run(() => request(`${base}/notes`, "POST", { text: turn?.text, source: "aside" }).then(() => request(base)));
      }
      if (action === "clear") return void this.run(() => request(`${base}/thread`, "DELETE").then(() => request(base)));
      if (action === "save-settings") {
        const next = { ...s.data.settings };
        for (const el of this.querySelectorAll("[data-setting]")) next[el.dataset.setting] = el.type === "number" ? Number(el.value) : el.value;
        return void this.run(async () => (await request("/settings", "PUT", next), request(base)));
      }
      if (action === "stop") return void this.abort?.abort();
      if (action === "ask") return void this.ask();
    }

    async ask() {
      const s = this.state;
      const question = s.question.trim();
      if (!question || s.busy) return;
      const chatId = s.chatId;
      this.abort = new AbortController();
      Object.assign(s, { busy: true, streaming: "", error: "" });
      this.render();
      try {
        const base = `/chats/${encodeURIComponent(chatId)}`;
        const prepared = await request(`${base}/prepare`, "POST", { question });
        const answer = await ask(chatId, prepared, (text) => {
          s.streaming += text;
          this.render();
        }, this.abort.signal);
        const result = await request(`${base}/exchange`, "POST", { question, answer });
        if (chatId === s.chatId) s.data = { ...s.data, ...result };
        s.question = "";
      } catch (error) {
        if (error.name !== "AbortError") s.error = error.message;
      } finally {
        s.busy = false;
        this.render();
      }
    }
  }

  if (!customElements.get(TAG)) customElements.define(TAG, AsideElement);
})();
