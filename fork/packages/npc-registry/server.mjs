// NPC Registry: the names (and pronouns) already used in a story, so the story model
// never duplicates one. One graph per chat (see graph.mjs), written by the
// post-processing extractor agent, read by the roster prompt context and the
// npc_registry_lookup name check. NPC descriptions live in Lorebook Keeper entries.

import { activeSwipes, applyOps, emptyGraph, findByName, inheritGraph, nameCollision, resolve } from "./graph.mjs";

export const PACKAGE_ID = "npc-registry";
const DOC_KIND = "npc-graph";
const MODES = new Set(["roleplay", "game"]);
const ROSTER_LIMIT = 150;

const docId = (chatId) => `${PACKAGE_ID}:${chatId}`;
const parseMeta = (value) => {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
};
const isEnabled = (meta, mode) =>
  MODES.has(mode) &&
  meta?.enableAgents === true &&
  Array.isArray(meta.activeAgentIds) &&
  meta.activeAgentIds.includes(PACKAGE_ID);

export function createStore(runtime) {
  const { persistence } = runtime;
  const { documents } = persistence;

  async function load(chatId, depth = 0) {
    const doc = await documents.getById(PACKAGE_ID, docId(chatId));
    if (doc) return { graph: doc.data, revision: doc.revision };
    // A branch starts with its parent's NPCs, remapped onto the copied messages.
    const chat = await persistence.getChat(chatId);
    const parentId = chat?.branch?.parentChatId;
    if (parentId && depth < 8) {
      const parent = await load(parentId, depth + 1);
      if (parent.graph.assertions.length) {
        const [parentMessages, messages] = await Promise.all([
          persistence.listMessages(parentId),
          persistence.listMessages(chatId),
        ]);
        return { graph: inheritGraph(parent.graph, parentMessages, messages), revision: 0 };
      }
    }
    return { graph: emptyGraph(), revision: 0 };
  }

  async function save(chatId, graph, revision) {
    const now = new Date().toISOString();
    const base = {
      id: docId(chatId),
      packageId: PACKAGE_ID,
      name: `NPC graph ${chatId}`,
      description: "",
      data: graph,
    };
    if (revision) {
      // The host returns null (not a throw) when the revision moved underneath us.
      const updated = await documents.update({ ...base, expectedRevision: revision, updatedAt: now });
      if (!updated) throw new Error("NPC graph changed concurrently");
      return updated;
    }
    return documents.create({ ...base, kind: DOC_KIND, createdAt: now, updatedAt: now });
  }

  async function current(chatId) {
    const [{ graph }, messages] = await Promise.all([load(chatId), persistence.listMessages(chatId)]);
    return resolve(graph, activeSwipes(messages));
  }

  return { load, save, current };
}

const publicCard = (entry) => ({
  name: entry.name,
  ...(entry.aliases.length ? { aliases: entry.aliases } : {}),
  ...(entry.gender ? { gender: entry.gender } : {}),
});

/** Name check: established NPCs whose name or alias matches or collides with `name`. */
export async function lookup(runtime, store, chatId, args) {
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isEnabled(parseMeta(chat.metadata), chat.mode)) {
    return { enabled: false, note: "The NPC registry is not active in this chat." };
  }
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) return { verdict: "clear", matches: [], note: "Pass a name to check." };
  const resolved = await store.current(chatId);
  const exact = findByName(resolved, name);
  const matches = exact
    ? [{ ...publicCard(exact), why: "established NPC" }]
    : [...resolved.npcs.values()].flatMap((entry) => {
        for (const candidate of [entry.name, ...entry.aliases]) {
          const why = nameCollision(name, candidate);
          if (why) return [{ ...publicCard(entry), why }];
        }
        return [];
      });
  return matches.length
    ? {
        verdict: exact ? "established" : "conflict",
        matches: matches.slice(0, 5),
        note: exact
          ? "This NPC already exists; keep their established pronouns."
          : "Reuse the existing NPC if it is the same person; otherwise pick a clearly different name.",
      }
    : { verdict: "clear", matches: [], note: "No established NPC by that name or a similar one." };
}

/** The extractor's view: the roster as [id, name, gender, ...aliases]. */
export async function prepare(store, context) {
  if (!MODES.has(context?.chatMode)) return null;
  const resolved = await store.current(context.chatId);
  return {
    roster: [...resolved.npcs.values()].map((entry) => [entry.id, entry.name, entry.gender ?? "", ...entry.aliases]),
    notNpcs: [...(context.characters ?? []).map((c) => c.name), context.persona?.name].filter(Boolean),
  };
}

/** The message this run describes: the newest assistant message matching mainResponse. */
function anchorFor(messages, mainResponse) {
  const assistants = messages.filter((message) => message.role === "assistant");
  const target =
    assistants.findLast((message) => mainResponse && message.content.trim() === mainResponse.trim()) ??
    assistants.at(-1);
  return target ? { m: target.id, w: target.activeSwipeIndex ?? 0 } : null;
}

export async function finalize(runtime, store, { context, preparedContext, result }) {
  const done = (diagnostics) => ({
    ...result,
    type: "context_injection",
    data: { text: "", diagnostics },
    success: true,
    error: null,
  });
  if (!result?.success || !MODES.has(context?.chatMode)) return result;
  const raw = typeof result.data?.text === "string" ? result.data.text : "";
  if (!raw.trim()) return done({ applied: 0, skipped: 0 });
  let parsed;
  try {
    parsed = runtime.json.parseJsonish(raw);
  } catch {
    return done({ error: "extractor output was not JSON" });
  }
  const ops = Array.isArray(parsed) ? parsed : parsed?.ops;
  if (!Array.isArray(ops) || !ops.length) return done({ applied: 0, skipped: 0 });

  // Single writer per chat, but retry once if a concurrent run bumped the revision.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [{ graph, revision }, messages] = await Promise.all([
      store.load(context.chatId),
      runtime.persistence.listMessages(context.chatId),
    ]);
    const anchor = anchorFor(messages, context.mainResponse);
    if (!anchor) return done({ error: "no assistant message to anchor to" });
    const counts = applyOps(graph, ops, anchor, activeSwipes(messages), { exclude: preparedContext?.notNpcs ?? [] });
    if (!counts.applied) return done(counts);
    try {
      await store.save(context.chatId, graph, revision);
      return done(counts);
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  return done({ applied: 0, skipped: ops.length });
}

export function rosterContext(store) {
  return async (request) => {
    if (!isEnabled(request?.chatMeta, request?.mode)) return null;
    const resolved = await store.current(request.chatId);
    // Names (and pronouns) only, in creation order: the roster lands in the system prompt, so it
    // must change only when an NPC is created, renamed or gendered, not on every fact update.
    const names = [...resolved.npcs.values()]
      .map((entry) => (entry.gender ? `${entry.name} (${entry.gender})` : entry.name))
      .slice(0, ROSTER_LIMIT);
    const head =
      "NPC registry: named NPCs already in this story, with their pronouns. Keep those pronouns. " +
      "Never give a new character one of these names or a near-copy; if unsure, call npc_registry_lookup with the name.";
    return names.length ? `${head}\nEstablished NPCs: ${names.join(", ")}` : head;
  };
}

const TOOL = {
  name: "lookup",
  description:
    "Only use when the system prompt contains an NPC registry block; otherwise ignore this tool. " +
    "Checks a character name against the NPCs already in this story: returns the established NPC (with pronouns) " +
    "or names that are too similar. Call it before naming a new character.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name to check: a new character's intended name or an existing NPC." },
    },
    required: ["name"],
    additionalProperties: false,
  },
};

export async function activate(context) {
  const runtime = context.api.runtime;
  const store = createStore(runtime);
  const releases = [];
  try {
    releases.push(
      context.api.registerService(`agent-runtime:${PACKAGE_ID}`, {
        prepareContext: ({ context: agentContext }) => prepare(store, agentContext),
        finalizeResult: (input) => finalize(runtime, store, input),
      }),
    );
    releases.push(
      context.api.registerTool({
        ...TOOL,
        handler: async (args, call) => {
          const result = await lookup(runtime, store, call.chatId, args ?? {});
          // Usage evidence: is the story model calling the registry at all? Query Loki for "[npc-registry] lookup".
          runtime.logger?.info(
            "[npc-registry] lookup chat=%s args=%j -> %s",
            call.chatId,
            args ?? {},
            result.verdict ?? (result.found ? `found ${result.found.length}` : "disabled"),
          );
          return result;
        },
      }),
    );
    releases.push(context.api.registerPromptContext(rosterContext(store)));
  } catch (error) {
    for (const release of releases.reverse()) await release();
    throw error;
  }
  return async () => {
    for (const release of releases.reverse()) await release();
  };
}
