// NPC knowledge graph: append-only nodes + assertions, resolved per read.
//
// Nothing is edited in place. A change is a new assertion that `sup`ersedes older
// ones; a retraction is a tombstone assertion (o: null). Every assertion is anchored
// to the message + swipe that produced it, so swiping, regenerating or deleting a
// message hides its facts with no cleanup, and swiping back restores them.

export const SINGLE = new Set(["name", "role", "archetype", "appearance", "status", "location", "faction"]);
export const MULTI = new Set(["alias", "trait", "deed"]);
const MAX_VALUE = 300;

export function emptyGraph() {
  return { v: 1, seq: 0, nodes: {}, assertions: [] };
}

const nextId = (graph, prefix) => `${prefix}${(graph.seq += 1).toString(36)}`;
const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_VALUE) : "");

/** Lowercase, strip accents, punctuation and leading titles. */
export function normalizeName(name) {
  return clean(name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, " ")
    .replace(
      /^(?:(?:the|old|young|lady|lord|sir|dame|captain|capt|commander|sergeant|sgt|doctor|dr|mr|mrs|ms|miss|master|mistress|father|mother|brother|sister|king|queen|prince|princess|professor|prof)\.?\s+)+/,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** messageId -> active swipe index, from the host's message list. */
export function activeSwipes(messages) {
  return new Map(messages.map((message) => [message.id, message.activeSwipeIndex ?? 0]));
}

function isValid(assertion, swipes) {
  if (!assertion.a) return true; // unanchored (manual) facts are always valid
  return swipes.has(assertion.a.m) && swipes.get(assertion.a.m) === assertion.a.w;
}

/**
 * Resolve the graph against the active message path.
 * Returns { npcs: Map<canonicalId, card>, canonical: (id) => canonicalId, live: assertion[] }.
 */
export function resolve(graph, swipes) {
  const valid = graph.assertions.filter((assertion) => isValid(assertion, swipes));
  const superseded = new Set(valid.flatMap((assertion) => assertion.sup ?? []));
  const live = valid.filter((assertion) => !superseded.has(assertion.id) && assertion.o !== null);

  // same_as merges: the duplicate (s) folds into the original (o).
  const parent = new Map();
  const find = (id) => {
    while (parent.has(id)) id = parent.get(id);
    return id;
  };
  const order = Object.keys(graph.nodes);
  for (const assertion of live) {
    if (assertion.p !== "same_as") continue;
    const [drop, keep] = [find(assertion.s), find(assertion.o)];
    if (drop !== keep && graph.nodes[drop] && graph.nodes[keep]) parent.set(drop, keep);
  }

  const position = new Map([...swipes.keys()].map((id, index) => [id, index]));
  const npcs = new Map();
  const card = (id) => {
    if (!npcs.has(id)) {
      npcs.set(id, { id, name: "", aliases: [], traits: [], deeds: [], relations: [], merged: [] });
    }
    return npcs.get(id);
  };
  for (const assertion of live) {
    if (assertion.p === "same_as") continue;
    const target = card(find(assertion.s));
    if (assertion.p === "name") {
      if (find(assertion.s) !== assertion.s) target.aliases.push(assertion.o);
      else target.name = assertion.o;
    } else if (SINGLE.has(assertion.p)) target[assertion.p] = assertion.o;
    else if (assertion.p === "alias") target.aliases.push(assertion.o);
    else if (assertion.p === "trait") target.traits.push(assertion.o);
    else if (assertion.p === "deed") target.deeds.push({ o: assertion.o, at: position.get(assertion.a?.m) ?? -1 });
    else if (assertion.p.startsWith("rel:")) target.relations.push({ type: assertion.p.slice(4), other: assertion.o });
  }
  for (const [id, entry] of npcs) {
    if (!entry.name) {
      // Its own name assertion is gone (discarded swipe) — the NPC does not exist on this path.
      npcs.delete(id);
      continue;
    }
    for (const [other, root] of order.map((nodeId) => [nodeId, find(nodeId)])) {
      if (root === id && other !== id) entry.merged.push(other);
    }
    entry.aliases = [...new Set(entry.aliases.filter((alias) => alias !== entry.name))];
    entry.traits = [...new Set(entry.traits)];
    // Story order, not write order: a backfill or retry can record an older deed later.
    entry.deeds = [...new Set(entry.deeds.sort((a, b) => a.at - b.at).map((deed) => deed.o))];
  }
  for (const entry of npcs.values()) {
    entry.relations = entry.relations
      .map((relation) => ({ type: relation.type, other: npcs.get(find(relation.other))?.name ?? null }))
      .filter((relation) => relation.other);
  }
  return { npcs, canonical: find, live };
}

/** Find an existing NPC by exact normalized name or alias. */
export function findByName(resolved, name) {
  const key = normalizeName(name);
  if (!key) return null;
  for (const entry of resolved.npcs.values()) {
    if ([entry.name, ...entry.aliases].some((candidate) => normalizeName(candidate) === key)) return entry;
  }
  return null;
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Why `proposed` collides with `existing`, or null. */
export function nameCollision(proposed, existing) {
  const a = normalizeName(proposed);
  const b = normalizeName(existing);
  if (!a || !b) return null;
  if (a === b) return "same name";
  const ratio = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  if (ratio >= 0.75) return "near-identical spelling";
  const tokensA = a.split(" ").filter((token) => token.length >= 3);
  const tokensB = new Set(b.split(" ").filter((token) => token.length >= 3));
  const shared = tokensA.filter((token) => tokensB.has(token));
  if (shared.length) return `shares the name "${shared[0]}"`;
  return null;
}

const words = (text) =>
  new Set(
    normalizeName(text)
      .split(" ")
      .filter((word) => word.length >= 4),
  );

/** Summary used for archetype similarity (embeddings or word overlap). */
export function conceptText(entry) {
  return [entry.role, entry.archetype, ...(entry.traits ?? [])].filter(Boolean).join("; ");
}

export function wordOverlap(a, b) {
  const [left, right] = [words(a), words(b)];
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

/**
 * Apply extractor operations anchored to `anchor` ({ m, w }). Returns counts.
 * Refs: an op names an NPC by node id, by a `ref` from a create op in the same
 * batch, or by an existing name/alias. Unresolvable ops are skipped, never guessed.
 */
export function applyOps(graph, ops, anchor, swipes, { exclude = [] } = {}) {
  const excluded = new Set(exclude.map(normalizeName).filter(Boolean));
  const refs = new Map();
  let applied = 0;
  let skipped = 0;
  const add = (s, p, o, sup) => {
    graph.assertions.push({ id: nextId(graph, "a"), s, p, o, a: anchor, ...(sup?.length ? { sup } : {}) });
    applied += 1;
  };
  const current = () => resolve(graph, swipes);
  const lookup = (ref) => {
    if (typeof ref !== "string" || !ref.trim()) return null;
    if (refs.has(ref)) return refs.get(ref);
    const resolved = current();
    if (graph.nodes[ref]) return resolved.canonical(ref);
    return findByName(resolved, ref)?.id ?? null;
  };
  // Live assertion ids for (s, p[, o]); relation objects compare by canonical node.
  const liveFor = (s, p, o) => {
    const resolved = current();
    return resolved.live
      .filter(
        (assertion) =>
          resolved.canonical(assertion.s) === s &&
          assertion.p === p &&
          (o === undefined ||
            (p.startsWith("rel:")
              ? resolved.canonical(assertion.o) === o
              : normalizeName(assertion.o) === normalizeName(o))),
      )
      .map((assertion) => assertion.id);
  };
  // Message order, so a backfill of an old message never overrides a later message's value.
  const position = new Map([...swipes.keys()].map((id, index) => [id, index]));
  const at = position.get(anchor?.m) ?? Infinity;
  const isLater = (id) => {
    const a = graph.assertions.find((assertion) => assertion.id === id)?.a;
    return a ? (position.get(a.m) ?? -1) > at : false;
  };
  const setField = (s, field, value) => {
    const same = liveFor(s, field, value);
    const all = liveFor(s, field);
    if (same.length && same.length === all.length) return; // already the current value
    if (all.some(isLater)) return; // a later message already set it
    add(s, field, value, all);
  };

  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== "object") {
      skipped += 1;
      continue;
    }
    if (op.op === "create") {
      const name = clean(op.name);
      if (!name || excluded.has(normalizeName(name))) {
        skipped += 1;
        continue;
      }
      // Single source of truth: a create for a known name updates that NPC instead.
      let id = findByName(current(), name)?.id;
      if (!id) {
        id = nextId(graph, "n");
        graph.nodes[id] = { id };
        add(id, "name", name);
      }
      if (typeof op.ref === "string") refs.set(op.ref, id);
      for (const field of SINGLE) {
        if (field !== "name" && clean(op[field])) setField(id, field, clean(op[field]));
      }
      for (const trait of Array.isArray(op.traits) ? op.traits : []) {
        if (clean(trait) && !liveFor(id, "trait", trait).length) add(id, "trait", clean(trait));
      }
      continue;
    }
    const s = lookup(op.npc);
    if (!s) {
      skipped += 1;
      continue;
    }
    const field = typeof op.field === "string" ? op.field : "";
    const value = clean(op.value);
    if (op.op === "set" && SINGLE.has(field) && value) {
      setField(s, field, value);
    } else if (op.op === "add" && MULTI.has(field) && value) {
      if (!liveFor(s, field, value).length) add(s, field, value);
    } else if (op.op === "relate" && clean(op.type)) {
      const o = lookup(op.other);
      const p = `rel:${clean(op.type).toLowerCase().replace(/\s+/g, "_")}`;
      if (o && o !== s && !liveFor(s, p, o).length) {
        add(s, p, o);
      } else skipped += 1;
    } else if (op.op === "retract" && (MULTI.has(field) || field.startsWith("rel:"))) {
      const ids = field.startsWith("rel:")
        ? liveFor(s, field, op.value ? (lookup(op.value) ?? "") : undefined)
        : liveFor(s, field, value);
      if (ids.length) add(s, field, null, ids);
      else skipped += 1;
    } else if (op.op === "merge") {
      const into = lookup(op.into);
      if (into && into !== s) add(s, "same_as", into);
      else skipped += 1;
    } else {
      skipped += 1;
    }
  }
  return { applied, skipped };
}

/**
 * Copy a parent chat's graph into a branch. The branch copied the parent's messages
 * in order under new ids, so anchors are remapped by position; facts anchored past
 * the branch point are dropped.
 * ponytail: positional remap assumes the branch copied a prefix of the parent in
 * order with swipe indexes intact (true for /:id/branch today); if the Engine ever
 * exposes a source->branch message id map, use it instead.
 */
export function inheritGraph(parentGraph, parentMessages, branchMessages) {
  const map = new Map(parentMessages.slice(0, branchMessages.length).map((m, i) => [m.id, branchMessages[i].id]));
  const graph = structuredClone(parentGraph);
  graph.assertions = graph.assertions
    .filter((assertion) => !assertion.a || map.has(assertion.a.m))
    .map((assertion) => (assertion.a ? { ...assertion, a: { ...assertion.a, m: map.get(assertion.a.m) } } : assertion));
  return graph;
}
