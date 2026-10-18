"use strict";

// Shared World's Home page: the shared games, and for one game its players, the Game mode chats linked to it
// (link and unlink), and the feed of what each party changed in the world.
//
// Drawn with Marinara's theme tokens, safelisted utility classes and `mari-chrome-control` buttons; the only
// CSS here is layout.
(() => {
  const TAG_NAME = "marinara-capability-shared-world";
  const API = "/api/shared-world/v1";

  const BTN = "mari-chrome-control mari-chrome-control--small px-3";
  const BTN_PRIMARY = `${BTN} mari-chrome-control--primary`;
  const FIELD =
    "rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
  const CARD = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 space-y-2";
  const MUTED = "text-xs text-[var(--muted-foreground)]";
  const LAYOUT_CSS = `
    marinara-capability-shared-world { display: block; height: 100%; }
    .sw-root { height: 100%; display: flex; flex-direction: column; min-height: 0; }
    .sw-body { flex: 1; min-height: 0; overflow-y: auto; }
    .sw-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0.75rem; }
    @media (max-width: 820px) { .sw-grid { grid-template-columns: minmax(0, 1fr); } }
  `;

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

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

  class SharedWorldElement extends HTMLElement {
    constructor() {
      super();
      this.state = { games: null, game: null, chats: [], busy: "", error: "", scene: null, playAs: "" };
      this.draft = "";
      this.sceneTimer = null;
      this._props = null;
      this.addEventListener("click", (event) => this.onClick(event));
    }

    set capabilityProps(value) {
      this._props = value;
    }

    get capabilityProps() {
      return this._props;
    }

    connectedCallback() {
      this.render();
      void this.run("Loading", () => this.loadGames());
      this.addEventListener("input", (event) => {
        if (event.target.matches("[data-scene-text]")) this.draft = event.target.value;
      });
      this.addEventListener("change", (event) => {
        if (!event.target.matches("[data-play-as]")) return;
        this.state.playAs = event.target.value;
        this.draft = "";
        void this.pollScene().then(() => this.paintScene());
      });
      this.sceneTimer = setInterval(() => void this.pollScene(), 3000);
    }

    disconnectedCallback() {
      clearInterval(this.sceneTimer);
    }

    /** The scene card refreshes by itself while a scene is open; only its own parts are repainted, so a typed action survives. */
    async pollScene() {
      const game = this.state.game;
      if (!game || !this.state.playAs || this.state.busy) return;
      try {
        const { scene } = await call(`/games/${encodeURIComponent(game.id)}/scene/state`, "POST", { playerId: this.state.playAs });
        const before = this.sceneSignature();
        this.state.scene = scene;
        if (this.sceneSignature() !== before) this.paintScene();
      } catch {
        /* the next poll tries again */
      }
    }

    sceneSignature() {
      const scene = this.state.scene;
      return scene ? JSON.stringify([scene.round, scene.resolving, scene.mine, scene.members.map((m) => m.acted), scene.log.length]) : "none";
    }

    paintScene() {
      const holder = this.$("[data-scene]");
      if (holder) holder.innerHTML = this.renderScene();
      const box = this.$("[data-scene-text]");
      if (box) box.value = this.draft;
    }

    async sceneCall(path, body = {}) {
      const game = this.state.game;
      const { scene } = await call(`/games/${encodeURIComponent(game.id)}/scene/${path}`, "POST", { playerId: this.state.playAs, ...body });
      this.state.scene = scene;
    }

    $(selector) {
      return this.querySelector(selector);
    }

    async run(label, work) {
      this.state.busy = label;
      this.state.error = "";
      this.render();
      try {
        await work();
      } catch (error) {
        this.state.error = error.message;
      }
      this.state.busy = "";
      this.render();
    }

    async loadGames() {
      this.state.games = await call("/games");
    }

    async openGame(gameId) {
      const [game, chats] = await Promise.all([call(`/games/${encodeURIComponent(gameId)}`), call("/chats")]);
      this.state.game = game;
      this.state.chats = chats;
      const ids = game.together?.[0]?.playerIds ?? [];
      if (!ids.includes(this.state.playAs)) this.state.playAs = ids[0] ?? "";
      this.state.scene = null;
      if (this.state.playAs) {
        const { scene } = await call(`/games/${encodeURIComponent(game.id)}/scene/state`, "POST", { playerId: this.state.playAs });
        this.state.scene = scene;
      }
    }

    onClick(event) {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const { action, id } = button.dataset;
      const game = this.state.game;
      if (action === "close") return this._props?.onClose?.();
      if (action === "home") {
        this.state.game = null;
        return void this.run("Loading", () => this.loadGames());
      }
      if (action === "open") return void this.run("Loading", () => this.openGame(id));
      if (action === "create") {
        const name = this.$("[data-new-name]")?.value;
        return void this.run("Creating", async () => {
          const created = await call("/games", "POST", { name });
          await this.openGame(created.id);
        });
      }
      if (!game) return;
      if (action === "add-player") {
        const name = this.$("[data-player-name]")?.value;
        return void this.run("Adding", async () => {
          await call(`/games/${encodeURIComponent(game.id)}/players`, "POST", { name });
          await this.openGame(game.id);
        });
      }
      if (action === "link") {
        const playerId = this.$(`[data-player-for="${CSS.escape(id)}"]`)?.value;
        return void this.run("Linking", async () => {
          await call("/link", "POST", { chatId: id, gameId: game.id, playerId });
          await this.openGame(game.id);
        });
      }
      if (action === "unlink") {
        return void this.run("Unlinking", async () => {
          await call("/unlink", "POST", { chatId: id });
          await this.openGame(game.id);
        });
      }
      if (action === "delete-game") {
        if (!confirm(`Delete "${game.name}"? Its chats are unlinked and keep their world as it is now.`)) return;
        return void this.run("Deleting", async () => {
          await call(`/games/${encodeURIComponent(game.id)}`, "DELETE");
          this.state.game = null;
          await this.loadGames();
        });
      }
      if (action === "scene-start") {
        this.state.playAs = this.$("[data-play-as]")?.value || this.state.playAs;
        return void this.run("Starting the scene", () => this.sceneCall("start"));
      }
      if (action === "scene-act") {
        const text = this.$("[data-scene-text]")?.value;
        return void this.run("Sending", async () => {
          await this.sceneCall("act", { text });
          this.draft = "";
        });
      }
      if (action === "scene-retry") return void this.run("Narrating", () => this.sceneCall("retry"));
      if (action === "scene-end") {
        return void this.run("Ending the scene", async () => {
          await this.sceneCall("end");
          this.state.scene = null;
        });
      }
      if (action === "sync") {
        return void this.run("Syncing", async () => {
          await call(`/games/${encodeURIComponent(game.id)}/sync`, "POST", {});
          await this.openGame(game.id);
        });
      }
    }

    renderScene() {
      const { game, scene, playAs } = this.state;
      const together = game?.together?.[0];
      if (!scene) {
        if (!together) return `<h2 class="text-sm font-semibold">Scene</h2><p class="${MUTED}">When two parties stand at the same place, they can play a round together here.</p>`;
        const options = together.playerIds
          .map((id, index) => `<option value="${escapeHtml(id)}" ${id === playAs ? "selected" : ""}>${escapeHtml(together.players[index] ?? "Player")}</option>`)
          .join("");
        return `<h2 class="text-sm font-semibold">Scene</h2>
          <p class="${MUTED}">${escapeHtml(together.players.join(" and "))} are together at ${escapeHtml(together.place)}. Each player writes their own character's action; once everyone has, one narration goes into every chat.</p>
          <div class="flex flex-wrap items-center gap-2"><span class="${MUTED}">Playing as</span>
            <select class="${FIELD}" data-play-as>${options}</select>
            <button type="button" class="${BTN_PRIMARY}" data-action="scene-start">Go synchronous</button></div>`;
      }
      const color = (name) => {
        const index = scene.members.findIndex((member) => member.name === name);
        return `hsl(${(index < 0 ? 0 : index) * 150 + 20} 70% 70%)`;
      };
      const log = scene.log
        .map(
          (entry) => `<div class="space-y-1 border-t border-[var(--border)] pt-2">
            ${entry.actions.map((a) => `<div class="text-sm"><b style="color:${color(a.name)}">${escapeHtml(a.name)}</b> ${escapeHtml(a.text)}</div>`).join("")}
            <div class="whitespace-pre-wrap text-sm italic">${escapeHtml(entry.narration)}</div></div>`,
        )
        .join("");
      const chips = scene.members
        .map((m) => `<span class="text-xs" style="color:${color(m.name)}">${escapeHtml(m.name)} ${m.acted ? "✓" : "…"}</span>`)
        .join(" ");
      const everyoneActed = scene.members.every((m) => m.acted);
      const waiting = scene.members.filter((m) => !m.acted).map((m) => m.name);
      const input = scene.mine
        ? `<p class="${MUTED}">${scene.resolving ? "Narrating…" : everyoneActed ? "The narration failed." : `Waiting for ${escapeHtml(waiting.join(" and "))}.`}</p>
           ${everyoneActed && !scene.resolving ? `<button type="button" class="${BTN}" data-action="scene-retry">Narrate again</button>` : ""}
           <p class="text-sm">Your action: ${escapeHtml(scene.mine)}</p>`
        : `<textarea class="${FIELD} w-full" rows="3" data-scene-text placeholder="What does your character do?"></textarea>
           <button type="button" class="${BTN_PRIMARY}" data-action="scene-act">Send</button>`;
      return `<div class="flex items-center gap-2"><h2 class="flex-1 text-sm font-semibold">Scene at ${escapeHtml(scene.place)} · round ${scene.round}</h2>
          ${chips}<select class="${FIELD}" data-play-as aria-label="Playing as">${scene.members.map((m) => `<option value="${escapeHtml(m.playerId)}" ${m.playerId === playAs ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}</select>
          <button type="button" class="${BTN}" data-action="scene-end">End scene</button></div>
        ${log}<div class="space-y-2 border-t border-[var(--border)] pt-2">${input}</div>`;
    }

    renderGames() {
      const games = this.state.games ?? [];
      return `<div class="mx-auto max-w-3xl space-y-3 p-4">
        <div class="${CARD}">
          <h2 class="text-sm font-semibold">New shared game</h2>
          <p class="${MUTED}">Game mode chats linked to it share one world (its characters, maps, items and overview) and each keep their own story.</p>
          <div class="flex flex-wrap gap-2">
            <input class="${FIELD} flex-1" data-new-name placeholder="Fallout: New Vegas" />
            <button type="button" class="${BTN_PRIMARY}" data-action="create">Create</button>
          </div>
        </div>
        ${games
          .map(
            (game) => `<button type="button" class="${CARD} w-full text-left" data-action="open" data-id="${escapeHtml(game.id)}">
              <div class="text-sm font-semibold">${escapeHtml(game.name)}</div>
              <div class="${MUTED}">${game.players.length} players · ${game.records} shared records</div>
            </button>`,
          )
          .join("")}
        ${this.state.games && !games.length ? `<p class="${MUTED}">No shared games yet.</p>` : ""}
      </div>`;
    }

    renderGame() {
      const { game, chats } = this.state;
      const players = game.players ?? [];
      const playerName = new Map(players.map((player) => [player.id, player.name]));
      const options = players.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
      const chatRows = chats
        .filter((chat) => !chat.link || chat.link.gameId === game.id)
        .map((chat) => {
          const linked = chat.link?.gameId === game.id;
          const control = linked
            ? `<span class="${MUTED}">as ${escapeHtml(playerName.get(chat.link.playerId) ?? "?")}</span>
               <button type="button" class="${BTN}" data-action="unlink" data-id="${escapeHtml(chat.id)}">Unlink</button>`
            : players.length
              ? `<select class="${FIELD} py-1" data-player-for="${escapeHtml(chat.id)}">${options}</select>
                 <button type="button" class="${BTN}" data-action="link" data-id="${escapeHtml(chat.id)}"${chat.setUp ? "" : " disabled title=\"Finish its setup first\""}>Link</button>`
              : `<span class="${MUTED}">Add a player first</span>`;
          return `<li class="flex items-center gap-2">
            <span class="min-w-0 flex-1 truncate text-sm">${escapeHtml(chat.name || "Untitled game")}${chat.status ? ` <span class="${MUTED}">${escapeHtml(chat.status)}</span>` : ""}</span>
            ${control}</li>`;
        })
        .join("");
      const feed = game.feed
        .map(
          (record) => `<li class="${CARD}">
            <div class="${MUTED}">#${record.seq} · ${escapeHtml(record.player)} · ${escapeHtml(new Date(record.at).toLocaleString())}</div>
            <div class="text-sm">${escapeHtml(record.text)}</div>
          </li>`,
        )
        .join("");
      return `<div class="mx-auto max-w-5xl space-y-3 p-4">
        <div class="${CARD} flex flex-wrap items-center gap-3">
          <div class="flex-1"><div class="text-lg font-semibold">${game.records} shared records</div>
            <div class="${MUTED}">Linked chats sync when they generate and every minute.</div></div>
          <button type="button" class="${BTN}" data-action="sync">Sync now</button>
          <button type="button" class="${BTN}" data-action="delete-game">Delete game</button>
        </div>
        <div class="${CARD}" data-scene>${this.renderScene()}</div>
        ${(game.together ?? [])
          .map(
            (t) =>
              `<div class="${CARD}">${escapeHtml(t.players.join(" and "))} ${t.players.length > 1 ? "are" : "is"} together at ${escapeHtml(t.place)}.</div>`,
          )
          .join("")}
        <div class="sw-grid">
          <div class="space-y-3">
            <div class="${CARD}">
              <h2 class="text-sm font-semibold">Players</h2>
              <ul class="text-sm">${players.map((p) => `<li>${escapeHtml(p.name)}</li>`).join("") || `<li class="${MUTED}">None yet</li>`}</ul>
              <div class="flex gap-2"><input class="${FIELD} flex-1" data-player-name placeholder="Name" />
                <button type="button" class="${BTN}" data-action="add-player">Add</button></div>
            </div>
            <div class="${CARD}">
              <h2 class="text-sm font-semibold">Game chats</h2>
              <p class="${MUTED}">Link a Game mode chat right after its setup, before its first turn. The first chat linked seeds the world; each later one joins it, taking on its cast and maps and starting where the first party started. Unlinking keeps the world as it is in the chat.</p>
              <ul class="space-y-2">${chatRows || `<li class="${MUTED}">No Game mode chats.</li>`}</ul>
            </div>
          </div>
          <div class="space-y-2">
            <h2 class="text-sm font-semibold">What happened</h2>
            <ul class="space-y-2">${feed || `<li class="${MUTED}">Nothing shared yet. Link a chat to seed the world.</li>`}</ul>
          </div>
        </div>
      </div>`;
    }

    render() {
      const { game, busy, error } = this.state;
      this.innerHTML = `<style>${LAYOUT_CSS}</style><div class="sw-root text-[var(--foreground)]">
        <header class="flex items-center gap-2 border-b border-[var(--border)] px-4 py-2">
          ${game ? `<button type="button" class="${BTN}" data-action="home">Games</button>` : ""}
          <h1 class="min-w-0 flex-1 truncate text-base font-semibold">${escapeHtml(game?.name ?? "Shared World")}</h1>
          ${busy ? `<span class="${MUTED}">${escapeHtml(busy)}…</span>` : ""}
          ${error ? `<span class="text-xs text-red-300">${escapeHtml(error)}</span>` : ""}
          ${this._props?.onClose ? `<button type="button" class="${BTN}" data-action="close">Close</button>` : ""}
        </header>
        <div class="sw-body">${game ? this.renderGame() : this.renderGames()}</div>
      </div>`;
      const box = this.$("[data-scene-text]");
      if (box) box.value = this.draft;
      if (busy) for (const button of this.querySelectorAll("button")) if (button.dataset.action !== "close") button.disabled = true;
    }
  }

  if (!customElements.get(TAG_NAME)) customElements.define(TAG_NAME, SharedWorldElement);
})();
