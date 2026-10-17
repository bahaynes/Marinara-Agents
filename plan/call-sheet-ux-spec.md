# Call Sheet: Architectural & UX Technical Specification (`v0.6.0` Target)

> **Document Status**: Architectural & UX Specification (`v1.0` — Implementation-Ready)
> **Target Repositories**: `Marinara-Agents` (`fork/packages/call-sheet/`) & `Marinara-Engine` (`custom-mods`)
> **Compatibility Baseline**: `capabilityApi: 1.19` | `engine.min: 2.5.0`
> **Companion Concept Document**: [`plan/call-sheet.md`](./call-sheet.md)

---

## 1. Architectural Crossroads: Package Extension vs. Native 4th Mode vs. Backing Chat Composition

To eliminate Call Sheet's "second-class webview" feel while maintaining a sustainable `custom-mods` fork on top of `upstream/staging`, we evaluate three architectural paths:

- **Option A — Sandboxed Capability Package (`slot: home-browser-tab`)**: Keep Call Sheet purely in `fork/packages/call-sheet/` inside `Marinara-Agents`, isolated in `capability_documents` with its own Light DOM renderer (`client.js`) and private prompt compiler (`sheet.mjs`).
- **Option B — Native 4th Engine Mode (`chat | rp | game | call-sheet`)**: Promote Call Sheet into `Marinara-Engine` core (`packages/client/src/components/call-sheet/`, `packages/server/src/routes/`, and Drizzle schema migrations).
- **Option C — Backing Chat Composition (`packageOrigin`) with Policy-Driven Caching**: Call Sheet remains a capability package that owns the story spine, scene planning state machine, and immutable summaries. However, instead of storing turns in private documents and isolating itself from native chat features, it branches real scene chats via the engine's built-in [`ScenePackageOrigin`](file:///home/bah/git/marinara-engine/packages/server/src/services/capability-packages/capability-scene-origin.service.ts) and [`SceneBanner`](file:///home/bah/git/marinara-engine/packages/client/src/components/chat/SceneBanner.tsx). Rather than forcibly stripping user presets, prompt caching is enforced via a **Prompt Health & Policy Engine** with a 1-click preset optimizer.

### Evaluation Matrix

| Criterion | Option A: Sandboxed Package (`fork/packages/call-sheet`) | Option B: Native 4th Engine Mode (`marinara-engine`) | Option C: Backing Chat Composition (`packageOrigin` + Policy) |
| :--- | :--- | :--- | :--- |
| **Rebase Conflict Impact vs. `upstream/staging`** | **Zero.** Lives entirely in `Marinara-Agents`. Never touches engine core. | **Severe & Compounding.** Adds `"call-sheet"` to core union; touches 40+ files across `ChatArea.tsx`, `generate.routes.ts`, etc. (Game Mode rebase tax). | **Zero to Minimal.** Uses existing native extension hooks ([`ScenePackageOrigin`](file:///home/bah/git/marinara-engine/packages/server/src/services/capability-packages/capability-scene-origin.service.ts), `scenePackageData`, `/api/scene/create`). Requires no new core mode branches. |
| **UI & React Component Leverage** | **Zero Leverage.** Must recreate auto-growing composer, markdown parsing, speech coloring, swipes, and turn edit tools in vanilla JS strings. | **High, but tightly coupled.** Direct React import, but bloats `ChatArea.tsx` with scene-mode conditions. | **Maximum Leverage.** Scenes render inside native [`ChatArea.tsx`](file:///home/bah/git/marinara-engine/packages/client/src/components/chat/ChatArea.tsx) with [`SceneBanner`](file:///home/bah/git/marinara-engine/packages/client/src/components/chat/SceneBanner.tsx) HUD. Full native composer, swipes, and hotkeys work out of the box. |
| **Native Agent Hooks (Illustrator, Avatars, TTS)** | **Completely Alienated.** Native agents require `(chatId, messageId, db)`. Call Sheet turns are invisible to the pipeline. | **Supported**, but tied to monolithic generation. | **100% Native Compatibility.** Turns are committed to `messages`, instantly triggering [`executePostProcessingAgents`](file:///home/bah/git/marinara-engine/packages/server/src/services/generation/agent-pipeline.ts) (Illustrator 2, TTS, Live 2D avatars). |
| **Prompt Caching & Preset Freedom** | **Enforced by Sandbox.** Rigid 5-block prompt layout; user presets, lorebooks, and style settings are disabled. | **Fragile.** Presets and chat settings constantly mutate prefix, dropping cache hits to ~0%. | **Policy-Driven Governance.** Users retain their preferred presets. An active **Prompt Health & Improvement Widget** audits prefix order and volatile macros, offering a 1-click cache optimizer. |

### Definitive Architectural Recommendation

**Choose Option C: Backing Chat Composition with Policy-Driven Caching.**

Option A was a defensive overcorrection to the trauma of Game Mode's invasive rebase conflicts. In eliminating rebase risk, it cut Call Sheet off from the entire React component tree and the native agent ecosystem.

By utilizing the engine's built-in [`ScenePackageOrigin`](file:///home/bah/git/marinara-engine/packages/server/src/services/capability-packages/capability-scene-origin.service.ts) bridge:
1. **The Director Layer** (Spine, Objectives, Cast Call, Review State, Scene Summaries) lives in Call Sheet.
2. **The Turn Layer** (Composer, Swipes, Avatars, Character Speech Colors, Illustrator 2, TTS) is inherited directly from native RP mode.
3. **Prompt Caching** becomes an empowering **Policy & Inspection System** that educates the user on prompt layout and saves token costs, rather than a blunt instrument that bans presets.

---

## 2. Feature & Parity Matrix

| Feature Domain | Native RP Mode (`ChatArea` / `ChatInput`) | Native Game Mode (`GameSurface` / `RoleplayHUD`) | Call Sheet Current (`v0.5.3`) | Call Sheet Target Specification (`v0.6.0`) |
| :--- | :--- | :--- | :--- | :--- |
| **1. Chat Input & Composer** | | | | |
| **Auto-Grow & Multi-line** | `resizeChatInputTextarea()` in `ChatInput.tsx`; measures with `overflowY: hidden` to prevent Firefox scrollbar bounce; caps at `200px` desktop / `24vh` mobile. | `GameInput.tsx` multi-line action box with freeform / choice toggle. | Naive `scrollHeight` in `onInput` without `overflowY: hidden` stabilization; height resets on full `render()`. | **Persistent Composer DOM** with overflow-stabilized auto-grow (`max-h-[12.5rem]` desktop, `24vh` mobile). Never destroyed during turn streaming or HUD toggles. |
| **Keyboard Shortcuts** | `Enter` or `Ctrl+Enter` configurable; `Escape` cancels edit/reply; `Up` edits last user turn. | `Ctrl+Enter` submits action; `1-4` selects choice cards. | `Ctrl+Enter` / `Cmd+Enter` triggers `Act` (if text) or `Continue` (if empty). | **`Ctrl/Cmd+Enter`**: `Act` (when input non-empty) or `Continue` (when empty). **`Shift+Ctrl/Cmd+Enter`**: `Send as written`. **`Escape`**: Abort active generation or close active drawer/edit. |
| **Dynamic Action Triggers** | Send, Continue, Impersonate (`WandSparkles`), Push Story, Stop (`StopCircle`). | Act / Do, Say, Inspect, Continue, Combat triggers. | `Act` (impersonate + reply), `Send as written`, `Continue`. Buttons disable during `busy`, no Stop button. | **Stateful Action Bar**: `Act` (primary pill, `ICON_SPARKLE`), `Send as written` (secondary pill), `Continue` (primary when awaiting reply, secondary when idle), and **live `Stop` button** (`ICON_STOP`) during SSE streaming that aborts the in-flight LLM call. |
| **Review-Before-Reply Banner** | N/A (Impersonate fills input box directly). | N/A | Amber alert banner above composer when `reviewTurns` is on and last turn is `persona`. | **Interactive Review Strip**: Shows above composer when last turn is `persona`, with inline quick-actions: **`[▶ Continue]`**, **`[↻ Reroll Turn]`**, **`[✎ Edit]`**. |
| **2. Turn Experience** | | | | |
| **Avatar & Speaker Rendering** | `ChatMessage.tsx`: User persona avatar + cropped frame; Assistant character avatar + `nameColor` header. | `GameNarration.tsx`: Ruled narration blocks with inline speaker portraits/badges. | Persona turn shows `who.avatarPath` (`h-8 w-8 rounded-full`) + `nameColor`. Narrator turn has no header or speaking cast avatars. | **Rich Turn Headers**: Persona turn renders avatar + `nameColor` + `from: <instruction>` pill. Narrator turn extracts speaking characters from `<speaker="Name">` tags and renders a cast speaker strip (mini avatars + `nameColor` chips) at the top of the bubble. |
| **Speech Highlighting & Markdown** | `DIALOGUE_QUOTE_PATTERN_SOURCE`, `<speaker="Name">` color mapping, `*italics*`, `**bold**`, `chatFontSize` / `chatFontColor`. | `game-narration-format.ts`: Dialogue coloring, stat check callouts, item badges. | `storyText()` parses `<speaker="Name">`, straight/curly quotes, `*italics*`, `**bold**`, and reads `marinara-engine-ui` localStorage prefs. | **Enhanced `storyText()`**: Preserves `<speaker="Name">` character `dialogueColor` mapping + multi-paragraph quote support + strips residual `<speaker>` tags cleanly during streaming. |
| **Hover Action Toolbar & Swipes** | `MessageActionButton.tsx` + `SwipeJumpControl.tsx` (`< 1/3 >`), Copy, Edit, Reroll, Delete, Branch, TTS. | Turn history replay & rollback controls. | Bottom-bordered footer inside bubble (`.cs-tools`), `< 1/N >` pager, Copy, Reroll (last turn only), Edit, Delete. | **Header Action Bar + Footer Swipe Pager**: Action buttons (Copy, Reroll, Edit, Delete) sit in the top-right header of the turn card on hover/focus-within; `< 1/N >` swipe pager + per-swipe cache/token badge sits cleanly in the footer when `swipes.length > 1`. |
| **3. Model & Generation Controls** | | | | |
| **Connection & Length Pickers** | `QuickConnectionSwitcher.tsx` popover pill in composer; preset token sliders in drawer. | `GameModelQuotaWidget.tsx` + connection switcher in top bar. | Native `<select class="opacity-0">` overlaid on pill badges in composer for `mainConnectionId` and `replyLength`. | **Triple Composer Pills**: Keep the zero-dependency native `<select>` overlay pattern for `mainConnectionId` and `replyLength` (styled strictly with `LAYOUT_CSS` + safelisted tokens), and add a 3rd pill toggle for `reviewTurns` (`Review: On/Off`). |
| **Token & Cache Telemetry** | `ChatStatsModal.tsx` + `PeekPromptModal.tsx` (prompt preview & token breakdown). | `GameModelQuotaWidget.tsx` live cache hit/miss & quota bar. | Single text line in right sidebar: `Prompt cache: 90% read over 3 calls · 570 token-equivalents`. | **Live Cache HUD Badge**: Compact cache badge in the top Scene HUD strip (`⚡ 90% cached · 570 eq`, or `Cache warming (<1k tok)` when prompt $< 1,024$ tokens) with full tooltip breakdown of reads, writes, uncached input, and output tokens. |
| **4. Scene Management & HUD** | | | | |
| **Scene Metadata & Cast HUD** | `SceneBanner.tsx` (`Film` icon + description + `EndSceneBar`) + `RoleplayHUD.tsx` (`MapPin` location, `Users` present cast, `Scroll` quests). | Top HUD bar (`GamePartyBar.tsx`, location banner, objective clocks) + collapsible side/bottom drawers. | Fixed 3-column grid (`15rem` stories, `1fr` main, `22rem` right panel); collapses crudely below `820px` by stacking the right panel below the transcript. | **2-Zone Director Layout + Top Scene HUD Strip**: Top HUD strip pinned below header displays `📍 Location`, `👥 Cast Present` (with avatars/colors), `🎯 Open Goals`, and `[🎬 Scene Sheet]`. Left story list collapses into a `[≡ Stories]` drawer when a story is open, giving the transcript and `22rem` Director Drawer full width. |
| **Scene Transitions & Proposals** | `SceneBanner` conclude/fork modals. | Chapter/scene transition cards with summary checkpoints. | Raw form inputs in right sidebar (`renderReview`); editing fields and clicking `Reroll` loses unsaved manual edits; no scene rating UI. | **Dedicated Scene Proposal & Cut Workflow**: 1) Draft edits in `renderReview` persist in memory (`draftPlans[index]`) across version switches and rerolls; 2) Interactive **Cast Present Chips** toggle characters into/out of the proposal; 3) **1–5 Star Scene Rating** bar on closed scenes (`KPI 2`). |

---

## 3. UI/UX Component & Layout Specification

### 3.1 Main Workspace Layout (Desktop & Mobile)

When viewing a story (`view === "story"`), the layout uses a **2-Zone Director Grid** (`1fr` center stage + `22rem` collapsible right Director Drawer on desktop; slide-over drawer on `< 960px`) with a **Compact Scene HUD Strip** directly beneath the main header. Switching stories is handled via the `[≡ Stories]` slide-over drawer or returning to the home list.

```
+--------------------------------------------------------------------------------------------------+
| [≡ Stories]  The Amber Lantern                          [⚡ 91% cache · 1.2k eq] [⚙] [◫ Scene]   |
+--------------------------------------------------------------------------------------------------+
| 📍 The Crossroads Inn  | 👥 Keeper, Mira              | 🎯 2 Goals          | [🎬 Cut & Next ▸]  |
+-----------------------------------------------------------------------+--------------------------+
|                                                                       | DIRECTOR DRAWER (22rem)  |
|  ─── SCENE 1: ARRIVAL AT DUSK ──────────────────────────────────────  |                          |
|  📍 The Crossroads Inn · Rain lashes the leaded glass windows.        | CURRENT SCENE (1)        |
|                                                                       | Location                 |
|  +-----------------------------------------------------------------+  | The Crossroads Inn       |
|  | [● Keeper] [● Mira]                                 [📋][✎][🗑] |  |                          |
|  | The hearth fire crackles low. **"We don't get many couriers     |  | Cast Present             |
|  | after sundown,"** the Keeper mutters, wiping a tankard.         |  | [● Keeper] [● Mira]      |
|  +-----------------------------------------------------------------+  |                          |
|                                                                       | Scene Goals              |
|  +-----------------------------------------------------------------+  | • Secure a room          |
|  | (T) Traveler  from: asks for a room & watches the corner table  |  | • Find the contact       |
|  |     +---------------------------------------------------------+ |  |                          |
|  |     | **"Just passing through,"** Traveler says, setting a    | |  | Facts in Play            |
|  |     | silver coin on the oak counter while glancing toward    | |  | • The road north is      |
|  |     | the hooded figure in the corner.                        | |  |   flooded.               |
|  |     |                                     [< 2/2 >] [📋][↻][✎]| |  |                          |
|  |     +---------------------------------------------------------+ |  | ──────────────────────── |
|  +-----------------------------------------------------------------+  | NEXT SCENE               |
|                                                                       | [Optional direction... ] |
|                                                                       | [🎬 End & Plan Next    ] |
+-----------------------------------------------------------------------+--------------------------+
|  [✦ Traveler's turn is written. Review above or press Continue.]      [↻ Reroll] [✎ Edit] [▶ Go] |
|  +--------------------------------------------------------------------------------------------+  |
|  | What does Traveler do? Short note is enough (Ctrl+Enter to Act)…                           |  |
|  | ------------------------------------------------------------------------------------------ |  |
|  | [🔗 Claude Sonnet ▾]  [📏 Medium (3–4 ¶) ▾]  [👁 Review: On]     [Send as written] [✦ Act] |  |
|  +--------------------------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------------------+
```

### 3.2 Unified Composer Bar Specification

```
+--------------------------------------------------------------------------------------------------+
|  +--------------------------------------------------------------------------------------------+  |
|  | [Amber Review Bar - Only visible when awaitingReply === true]                              |  |
|  | ✦ Traveler's turn is written.                   [↻ Reroll Turn] [✎ Edit] [▶ Continue (⏎)]  |  |
|  +--------------------------------------------------------------------------------------------+  |
|  +--------------------------------------------------------------------------------------------+  |
|  | <textarea data-input>                                                                      |  |
|  | Pushes the clerk on the register, suspects he is covering for someone...                   |  |
|  | ────────────────────────────────────────────────────────────────────────────────────────── |  |
|  | [🔗 Default (Opus) ▾]  [📏 Medium ▾]  [👁 Review: On]         [Send as written]  [✦ Act ⏎] |  |
|  +--------------------------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------------------+
```

**During Active Streaming (`state.busy` with active `AbortController`):**
- The right-hand action cluster (`[data-composer-actions]`) renders an enabled `[ ■ Stop ]` button (`data-action="stop"`):
  ```
  [ ⟳ Writing… ]  [ ■ Stop ]
  ```
- Clicking `[ ■ Stop ]` or pressing `Escape` invokes `this.abort()`, immediately cancelling the `fetch` stream and aborting the server-side model generation.

### 3.3 Turn Card Layout & Speech Markup

```
NARRATOR TURN (Assistant):
+--------------------------------------------------------------------------------------------------+
|  +--------------------------------------------------------------------------------------------+  |
|  | [● Keeper] [● Mira]                                               [📋 Copy] [↻] [✎] [🗑]   |  |
|  |                                                                                            |  |
|  | The rain beats harder against the shutters. **"Rooms are two silver tonight, and no        |  |
|  | questions asked,"** he says, sliding a brass key across the wet wood. Beside the hearth,   |  |
|  | **"You're late,"** Mira whispers.                                                          |  |
|  | ────────────────────────────────────────────────────────────────────────────────────────── |  |
|  | [< 1/2 >]                                                          cached 92% · 142 tok    |  |
|  +--------------------------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------------------+

PERSONA TURN (Player — Impersonated or Written):
+--------------------------------------------------------------------------------------------------+
|  +----+  Traveler  from: asks for a room & watches the corner        [📋 Copy] [↻] [✎] [🗑]   |
|  | AV |  +------------------------------------------------------------------------------------+  |
|  +----+  | **"Two silver is steep for a leaky roof,"** Traveler replies, palming the brass    |  |
|          | key before turning to Mira.                                                        |  |
|          | ────────────────────────────────────────────────────────────────────────────────── |  |
|          | [< 2/2 >]                                                  cached 89% · 118 tok    |  |
|          +------------------------------------------------------------------------------------+  |
+--------------------------------------------------------------------------------------------------+
```

### 3.4 Scene Proposal & Review Drawer

```
+--------------------------------------------------------------------------+
| 🎬 PROPOSED SCENE 2                                  [v1] [v2*] [↻ Reroll]|
| From: "A few hours later, debriefing upstairs over food"                 |
+--------------------------------------------------------------------------+
| Rate Scene 1 ("Arrival"):            [☆ 1] [☆ 2] [☆ 3] [★ 4] [☆ 5]       |
+--------------------------------------------------------------------------+
| Title                                                                    |
| [ Midnight Debriefing                                                  ] |
|                                                                          |
| Location                                                                 |
| [ Upper Room, The Crossroads Inn                                       ] |
|                                                                          |
| Cast Present (click chip to toggle, or edit lines below)                 |
| [✓ Keeper] [✓ Mira] [+ Guard Captain]                                    |
| +----------------------------------------------------------------------+ |
| | Keeper — brings up a tray of stew                                    | |
| | Mira — reveals the cipher she stole                                  | |
| +----------------------------------------------------------------------+ |
|                                                                          |
| What this scene is for (one per line)                                    |
| +----------------------------------------------------------------------+ |
| | Decode the magistrate's cipher                                       | |
| | Decide whether to trust the Keeper                                   | |
| +----------------------------------------------------------------------+ |
|                                                                          |
| Facts in play (one per line)                                             |
| +----------------------------------------------------------------------+ |
| | The north bridge washed out at sunset.                               | |
| +----------------------------------------------------------------------+ |
|                                                                          |
| Opening                                                                  |
| +----------------------------------------------------------------------+ |
| | A single tallow candle lights the low-beamed room as Mira spreads    | |
| | the oilskin map across the table.                                    | |
| +----------------------------------------------------------------------+ |
|                                                                          |
| [✓ Accept & Start Scene]                         [↻ Reroll]  [✕ Discard] |
+--------------------------------------------------------------------------+
```

### 3.5 CSS Token Mapping & Safelist Contract

`<marinara-capability-call-sheet>` must **never** use ad-hoc Tailwind utility classes that are absent from `packages/client/src/styles/capability-package-safelist.html`. Instead, all component-specific geometry, pills, and focus rings must be declared in `LAYOUT_CSS` inside `client.js` using Marinara's semantic CSS variables:

| CSS Class in `LAYOUT_CSS` | Marinara CSS Variables Used | Purpose |
| :--- | :--- | :--- |
| `.cs-root` | `var(--background)`, `var(--foreground)` | Full-height flex container inside Home Browser panel. |
| `.cs-hud` | `var(--marinara-chat-chrome-panel-bg)`, `var(--border)` | Compact top Scene HUD strip below header. |
| `.cs-composer-shell` | `var(--card)`, `var(--border)`, `var(--primary)`, `var(--ring)` | Rounded composer box with `focus-within` `color-mix(in oklch, var(--ring) 20%, transparent)` glow. |
| `.cs-pill` | `var(--secondary)`, `var(--foreground)`, `var(--border)`, `var(--accent)` | Model, length, review, and cast selector pills (replaces unsafelisted `bg-foreground/5`). |
| `.cs-pill[aria-pressed="true"]` | `var(--primary)`, `var(--primary-foreground)` | Active toggle pill state (e.g., `Review: On`, active cast chip, active proposal version). |
| `.cs-speaker-chip` | `var(--secondary)`, `var(--border)` | Mini avatar + colored character name badge at the top of narrator turns and in the Scene HUD. |

---

## 4. State Management & Lifecycle Contract

### 4.1 Persistence Schema in `capability_documents`

Call Sheet stores two document kinds under `packageId = "call-sheet"`:
1. **`call-sheet:story:<storyId>` (`kind: "story"`)**:
   - Holds `id`, `title`, `personaId`, `characterIds`, `mainConnectionId`, `agentConnectionId`, `settings: { replyLength, reviewTurns }`, and `sheet: { version: 2, spine, scenes, proposal }`.
   - Each closed scene in `sheet.scenes` stores `{ id, plan, instruction, startedAt, endedAt, summary, outcomes, rating }`, where `rating` is `1 | 2 | 3 | 4 | 5 | null`.
2. **`call-sheet:turns:<storyId>:<sceneId>` (`kind: "scene-turns"`)**:
   - Holds `{ turns: Turn[] }` for a single scene.
   - **Two-Phase Commit Invariant**: In `playTurn()`, when `kind` is `"instruction"` or `"written"`, the `persona` turn is saved to `call-sheet:turns:<storyId>:<sceneId>` **before** the narrator LLM call begins. If the narrator call fails or is aborted via `AbortController`, the player's turn remains safely persisted.

### 4.2 Provider-Agnostic Caching & Usage Normalization

1. **Prompt Prefix Stability (`sheet.mjs`)**:
   - `messages[0]` (`role: "system"`): `Block 1 (headBlock)` + `Block 2 (summaryBlock)` + `Block 3 (sceneBlock)`.
   - `messages[1..K-1]`: `Block 4 (historyMessages)`.
   - `messages[K]`: `Block 5 (tail instruction or newest persona turn)`.
   - Passed with `promptCache: { ttl: "1h", depth: 1 }`.
2. **Provider Usage Normalization (`cleanUsage` & `cacheStats` in `sheet.mjs`)**:
   - Providers differ in whether `promptTokens` includes cached tokens (OpenAI/Gemini/OpenRouter) or excludes them (Anthropic). When `usage.promptTokensIncludesCache === true`, `cleanUsage` subtracts `cachedPromptTokens` and `cacheWritePromptTokens` from `input` (`Math.max(0, promptTokens - read - write)`).
   - `cacheStats(turns)` computes `prompt = input + read + write`, `readShare = prompt ? read / prompt : 0`, `equivalents = Math.round(input + read * 0.1 + write * 2)`, and `warming = calls > 0 && read === 0 && write === 0 && prompt < 1024 * calls`.

### 4.3 Zone-Targeted DOM Updates & Request Cancellation (`client.js` & `server.mjs`)

1. **Surgical DOM Updates (`client.js`)**:
   - **Streaming**: `streamTurn()` never calls `this.render()`. On `{ type: "start", speaker }`, it mounts or resets a single `[data-writing-card]` element at the end of `[data-transcript-turns]` and updates `[data-writing]`'s `innerHTML` on each `{ type: "token", text }` event.
   - **Composer**: `onInput` on `[data-input]` resizes the textarea with `overflowY = "hidden"` stabilization and calls `this.updateComposerActions()`, never touching `this.innerHTML`.
   - **Proposal Drafts**: `this.state.draftPlans` caches user edits per proposal version index (`draftIndex`) on `input` events, so clicking `Reroll` (`reroll-plan`) or switching `v1`/`v2` preserves user edits in memory until `Accept` or `Discard`.
2. **End-to-End `AbortController` (`client.js` $\leftrightarrow$ `server.mjs`)**:
   - `client.js` creates `this._abort = new AbortController()` inside `streamTurn()` and passes `signal: this._abort.signal` to `callStream()`.
   - When `this.abort()` is called (via `[ ■ Stop ]` button or `Escape`), the client closes the HTTP connection and refreshes the story view (`GET /stories/:storyId`) so any saved persona turn from phase 1 of `Act` appears cleanly.
   - `server.mjs` attaches `request.raw.on("close", () => ac.abort())` in `stream()` and forwards `ac.signal` to `playTurn()` / `rerollTurn()` $\rightarrow$ `completeText()` $\rightarrow$ `model.chatComplete(fitted, { ..., signal })`.

---

## 5. Prompt Caching Policy Engine & Improvement Widget

Instead of enforcing prompt caching through a restrictive, hardcoded sandbox that disables user presets and style settings, Call Sheet enforces caching as an active **Policy & Inspection Engine**. Users keep their favorite presets, and Call Sheet provides real-time telemetry, actionable feedback, and a 1-click optimizer.

### 5.1 The 5 Golden Rules of Prompt Caching Policy

1. **Static Prefix Threshold**:
   - *Anthropic Claude*: The static prefix must be $\ge 1,024$ tokens to trigger the 1-hour ephemeral cache. Sub-threshold prompts are flagged with a `warning` ("warming phase") indicating full input rates apply.
   - *Google Gemini*: System instructions and documents benefit from large prefix caches ($\ge 32\text{k}$).
2. **Volatile Macro Contamination**:
   - Temporal macros (`{{date}}`, `{{time}}`, `{{datetime}}`, `{{isotime}}`, `{{weekday}}`, `{{idle_duration}}`), random macros (`{{random}}`, `{{roll:...}}`), variable mutators (`{{setvar}}`, `{{incvar}}`), and turn inputs (`{{input}}`) must **never** appear in static sections preceding the cache anchor.
   - Any volatile macro in a static section triggers a `critical` policy flag (estimated cache hit rate: 0%).
3. **Section Ordering & Cache Anchor Placement**:
   - Optimal sequence:
     ```
     [1. Static System Rules] ➔ [2. Persona & Character Cards] ➔ [3. Lorebook] ➔ [CACHE ANCHOR] ➔
     [4. Immutable Scene Summaries] ➔ [5. Dynamic Context / Macros] ➔ [6. Chat History] ➔ [7. Turn Input]
     ```
   - Placing dynamic markers (`chat_history`, `agent_data`) before static markers (`character`, `lorebook`) triggers a `section-order-inversion` penalty.
4. **Scene Summary Immutability**:
   - Finished scenes are frozen into immutable summaries. In the prompt, past summaries sit *before* the current scene's volatile turns, serving as an expanding cache-friendly anchor.
5. **1-Click Preset Optimization (`optimizePresetForCaching`)**:
   - Automatically clones the user's preset into a cache-optimized variant:
     - Moves volatile macro lines out of static system prompts into a post-cache `dynamic_context` block.
     - Reorders `sectionOrder` into the optimal sequence.
     - Preserves 100% of the user's custom instructions, formatting, and character voice.

### 5.2 Prompt Improvement Widget UX

Surfaced as a compact pill in the Scene HUD strip:
```
+----------------------------------------------------------------------------------------------------+
| ⚡ Cache Health: 35% (Critical)  [ Click to Inspect & Optimize ]                                   |
+----------------------------------------------------------------------------------------------------+
| ⚠️ Critical Cache Breakers Found:                                                                  |
| • Section "Main System" contains volatile macro(s): {{time}}, {{date}}.                            |
|   Values change every turn, reducing prompt cache hit rate to 0%.                                  |
|   Estimated cost impact: +450% input token overhead.                                               |
|                                                                                                    |
| • Static section "Character Roster" is placed after volatile "chat_history".                       |
|   Expanding turn history shifts character tokens on every turn.                                    |
|                                                                                                    |
| [ ✨ 1-Click Fix: Optimize Preset for Caching ]                               [ Dismiss ]          |
+----------------------------------------------------------------------------------------------------+
```

---

## 6. Phased Implementation Roadmap

### Phase 1: Server & Sheet Engine Upgrades (`sheet.mjs`, `server.mjs`, `tests/`) [COMPLETED]
- Avatar paths, `rateScene()`, `AbortController` signal forwarding, cache usage normalization. Verified with 9 passing unit tests.

### Phase 2: Client Architecture, Composer, Turn Cards & Scene HUD (`client.js`) [COMPLETED]
- 2-Zone Director Layout, Top Scene HUD Strip, surgical DOM updates (`mountWritingCard`), live Stop button (`Esc`), review turn banner, cast toggle chips, proposal draft memory preservation.

### Phase 3: Catalog Build & Repository Validation [COMPLETED]
- Rebuilt catalog v0.6.0, all validation suites passing (`npm run check`, `test-catalog-lanes`, `validate-catalog`).

### Phase 4: Prompt Policy Engine & Backing Chat Integration (`v0.7.0`)
- **Target Files**:
  - `fork/packages/call-sheet/prompt-policy.mjs`
  - `fork/packages/call-sheet/server.mjs`
  - `fork/packages/call-sheet/client.js`
  - `fork/packages/call-sheet/tests/prompt-policy.test.mjs`
- **Deliverables**:
  1. `prompt-policy.mjs`: Standalone analyzer detecting volatile macros, section inversions, and Anthropic thresholds, with `optimizePresetForCaching()`.
  2. Server routes `POST /stories/:id/policy/analyze` and `POST /stories/:id/policy/optimize`.
  3. Interactive Prompt Improvement Widget in the Scene HUD strip in `client.js`.
  4. Backing Chat integration via `ScenePackageOrigin` (`packages/server/src/services/capability-packages/capability-scene-origin.service.ts`), syncing scene turns with native `messages` and triggering `executePostProcessingAgents` (Illustrator 2, TTS, 2D live avatars).
- **Verification**:
  ```bash
  node --test fork/packages/call-sheet/tests/*.test.mjs
  npm run check
  node scripts/test-catalog-lanes.mjs
  ```
