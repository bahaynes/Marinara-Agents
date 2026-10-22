// NPC Registry: one graph per chat (see graph.mjs), written only by the
// post-processing extractor agent, read by the npc_registry_lookup tool and the
// roster prompt context.

import {
  activeSwipes,
  applyOps,
  conceptText,
  cosine,
  emptyGraph,
  findByName,
  inheritGraph,
  nameCollision,
  resolve,
  wordOverlap,
} from "./graph.mjs";

export const PACKAGE_ID = "npc-registry";
const DOC_KIND = "npc-graph";
const MODES = new Set(["roleplay", "game"]);
const ROSTER_LIMIT = 150;
const DEED_LIMIT = 8; // newest deeds per card, so mentioned cards stay small
const ARCHETYPE_THRESHOLD = { embedding: 0.82, words: 0.5 };

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

// ponytail: in-memory embedding cache, rebuilt after restart; persist vectors in the
// graph doc if cold-start lookups get slow.
const embeddingCache = new Map();
async function embedAll(runtime, texts) {
  const host = typeof runtime.resolveEmbeddings === "function" ? await runtime.resolveEmbeddings() : runtime.embeddings;
  if (!host?.embed) return null;
  const missing = texts.filter((text) => !embeddingCache.has(`${host.spaceId}\n${text}`));
  if (missing.length) {
    const vectors = await host.embed(missing);
    if (!vectors) return null;
    missing.forEach((text, index) => embeddingCache.set(`${host.spaceId}\n${text}`, vectors[index]));
  }
  return texts.map((text) => embeddingCache.get(`${host.spaceId}\n${text}`));
}

const publicCard = (entry) => ({
  name: entry.name,
  ...(entry.aliases.length ? { aliases: entry.aliases } : {}),
  ...Object.fromEntries(
    ["role", "archetype", "appearance", "status", "location", "faction"]
      .filter((field) => entry[field])
      .map((field) => [field, entry[field]]),
  ),
  ...(entry.traits.length ? { traits: entry.traits } : {}),
  ...(entry.deeds.length ? { deeds: entry.deeds.slice(-DEED_LIMIT) } : {}),
  ...(entry.relations.length ? { relations: entry.relations.map((r) => `${r.type}: ${r.other}`) } : {}),
});

export async function lookup(runtime, store, chatId, args) {
  const chat = await runtime.persistence.getChat(chatId);
  if (!chat || !isEnabled(parseMeta(chat.metadata), chat.mode)) {
    return { enabled: false, note: "The NPC registry is not active in this chat." };
  }
  const resolved = await store.current(chatId);
  const npcs = [...resolved.npcs.values()];
  if (typeof args.name === "string" && args.name.trim()) {
    const exact = findByName(resolved, args.name);
    const matches = exact
      ? [exact]
      : npcs.filter((entry) => [entry.name, ...entry.aliases].some((n) => nameCollision(args.name, n))).slice(0, 3);
    return matches.length
      ? { found: matches.map(publicCard) }
      : { found: [], note: "No established NPC by that name." };
  }

  const proposed = typeof args.proposed_name === "string" ? args.proposed_name : "";
  const concept = typeof args.concept === "string" ? args.concept : "";
  const nameConflicts = proposed
    ? npcs.flatMap((entry) => {
        for (const candidate of [entry.name, ...entry.aliases]) {
          const why = nameCollision(proposed, candidate);
          if (why) return [{ existing: entry.name, why }];
        }
        return [];
      })
    : [];

  let archetypeOverlaps = [];
  const withConcept = npcs.filter((entry) => conceptText(entry));
  if (concept && withConcept.length) {
    const texts = withConcept.map(conceptText);
    const vectors = await embedAll(runtime, [concept, ...texts]).catch(() => null);
    archetypeOverlaps = withConcept
      .map((entry, index) =>
        vectors
          ? { entry, score: cosine(vectors[0], vectors[index + 1]), kind: "embedding" }
          : { entry, score: wordOverlap(concept, texts[index]), kind: "words" },
      )
      .filter(({ score, kind }) => score >= ARCHETYPE_THRESHOLD[kind])
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(({ entry, score }) => ({
        existing: entry.name,
        role: entry.role ?? null,
        archetype: entry.archetype ?? null,
        similarity: Math.round(score * 100) / 100,
      }));
  }
  const clear = !nameConflicts.length && !archetypeOverlaps.length;
  return {
    verdict: clear ? "clear" : "conflict",
    nameConflicts,
    archetypeOverlaps,
    note: clear
      ? "No collision with established NPCs."
      : "Reuse the existing NPC if it fits; otherwise pick a clearly different name and concept.",
  };
}

/** The extractor's view: the roster plus full cards for NPCs the new message mentions. */
export async function prepare(store, context) {
  if (!MODES.has(context?.chatMode)) return null;
  const resolved = await store.current(context.chatId);
  const text = (context.mainResponse ?? "").toLowerCase();
  const npcs = [...resolved.npcs.values()];
  const mentioned = npcs.filter((entry) =>
    [entry.name, ...entry.aliases].some((n) =>
      n
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.length >= 3 && text.includes(word)),
    ),
  );
  return {
    roster: npcs.map((entry) => [entry.id, entry.name, ...entry.aliases]),
    mentioned: mentioned.slice(0, 20).map((entry) => ({ id: entry.id, ...publicCard(entry) })),
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
    // Names only, in creation order: the roster lands in the system prompt, so it must
    // change only when an NPC is created or renamed, not on every fact update.
    const names = [...resolved.npcs.values()].map((entry) => entry.name).slice(0, ROSTER_LIMIT);
    const head =
      "NPC registry: established named NPCs in this story. Reuse them instead of inventing look-alikes. " +
      "Before giving a new character a name, call npc_registry_lookup with proposed_name and concept; " +
      "call it with name to recall an NPC's established details.";
    return names.length ? `${head}\nEstablished NPCs: ${names.join(", ")}` : head;
  };
}

const TOOL = {
  name: "lookup",
  description:
    "Only use when the system prompt contains an NPC registry block; otherwise ignore this tool. " +
    "NPC registry for this story. Pass `name` to get an established NPC's facts and key deeds. Before introducing a new " +
    "named character, pass `proposed_name` and `concept` (role/archetype in a few words) to check for name " +
    "or archetype collisions with existing NPCs.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of an existing NPC to recall." },
      proposed_name: { type: "string", description: "Name you intend to give a new character." },
      concept: { type: "string", description: "The new character's role or archetype, a few words." },
    },
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
