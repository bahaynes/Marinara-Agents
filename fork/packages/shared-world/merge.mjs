// Shared World's merge: one shared copy of a Classic game's world (the hub) and, per linked chat, a base
// (what Shared World last wrote into that chat). A sync pushes what the chat changed since its base into the
// hub, then writes the hub back into the chat. Only the shared parts of these keys are touched:
//
//   gameNpcs           everything but reputation and the reputation-log notes (those are your party's)
//   gameMaps, gameMap  maps, nodes and edges; partyPosition, activeGameMapId and lastMapPosition stay yours
//   gameInventedItems  by id
//   gameWorldOverview  last writer wins
//
// Records are add-only: a record a chat lost (a swipe, a stale Engine write, a hand deletion) comes back from
// the hub. `discovered` is sticky, shared notes are a union. Nothing here touches storage.
//
// ponytail: deleting a record by hand does not stick (it comes back on the next sync), and a swiped-away
// reply's records stay shared once pushed. Per-chat tombstones in the base would fix both.

import { createHash } from "node:crypto";

export const parseMeta = (value) => {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export function sharedLink(meta) {
  const link = meta?.sharedWorld;
  return link && typeof link.gameId === "string" && typeof link.playerId === "string" ? link : null;
}

const NPC_FIELDS = [
  "name",
  "emoji",
  "description",
  "descriptionSource",
  "gender",
  "pronouns",
  "location",
  "avatarUrl",
  "worldId",
  "role",
];
const MAP_FIELDS = ["name", "description", "type", "spatialLocationId"];
const NODE_FIELDS = ["emoji", "label", "x", "y", "description", "spatialLocationId", "discovered"];
const ITEM_FIELDS = ["name", "summary", "item"];
const WORLD_KEYS = ["gameWorldOverview"];
/** Keys v0.1 wrote, removed on every sync. */
const RETIRED_KEYS = ["gameLedgerForeign", "gameWorldDayFloor"];
const NEWS_LIMIT = 30;

// The Engine's reputation log lines (reputation.service.ts applyReputationChange): your party's history.
const PERSONAL_NOTE = /^\[[^\]]*\] reputation [+-]?\d+(\.\d+)? → |^🏛️ Milestone: /;
const isPersonalNote = (note) => typeof note === "string" && PERSONAL_NOTE.test(note);

export const normalizeName = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sortKeys = (_key, value) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]))
    : value;
export const hashOf = (value) =>
  createHash("sha1")
    .update(JSON.stringify(value, sortKeys) ?? "")
    .digest("base64url")
    .slice(0, 16);

const array = (value) => (Array.isArray(value) ? value : []);
const hasId = (entry) => entry && typeof entry === "object" && typeof entry.id === "string" && entry.id;
const pick = (source, fields) => {
  const out = {};
  for (const field of fields) if (source?.[field] !== undefined) out[field] = source[field];
  return out;
};
const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const recordKind = (key) => key.slice(0, key.indexOf(":"));
const valuesOf = (record) => Object.fromEntries(Object.entries(record.fields).map(([f, cell]) => [f, cell.v]));

export const emptyHub = () => ({ seq: 0, world: {}, start: null });
export const emptyBase = () => ({ lastSeq: 0, alias: { npc: {}, map: {}, node: {} }, proj: {}, news: [] });

/** Node maps, with the active `gameMap` overriding its `gameMaps` entry (the Engine's getGameMapsFromMeta rule). */
function nodeMaps(meta) {
  const maps = array(meta.gameMaps).filter(hasId);
  const active = meta.gameMap;
  if (hasId(active)) {
    const index = maps.findIndex((map) => map.id === active.id);
    if (index >= 0) maps[index] = active;
    else maps.push(active);
  }
  // ponytail: grid maps (cells) are not shared; they would need a cell-keyed merge.
  return maps.filter((map) => map.type === "node");
}

const sharedMapId = (alias, mapId) => alias.map[mapId] ?? mapId;
const sharedNodeId = (alias, mapId, nodeId) => alias.node[`${mapId}/${nodeId}`] ?? nodeId;

/** The chat's shared state as `{ "<kind>:<shared id>": { field: value } }`. */
export function project(meta, alias) {
  const out = {};
  for (const npc of array(meta.gameNpcs).filter(hasId)) {
    const fields = pick(npc, NPC_FIELDS);
    const notes = array(npc.notes).filter((note) => typeof note === "string" && !isPersonalNote(note));
    if (notes.length) fields.notes = notes;
    out[`npc:${alias.npc[npc.id] ?? npc.id}`] = fields;
  }
  for (const map of nodeMaps(meta)) {
    const m = sharedMapId(alias, map.id);
    out[`map:${m}`] = pick(map, MAP_FIELDS);
    const nodes = array(map.nodes).filter(hasId);
    const ids = new Set(nodes.map((node) => node.id));
    for (const node of nodes) out[`node:${m}/${sharedNodeId(alias, map.id, node.id)}`] = pick(node, NODE_FIELDS);
    for (const edge of array(map.edges)) {
      if (!ids.has(edge?.from) || !ids.has(edge?.to) || edge.from === edge.to) continue;
      const key = edgeKey(sharedNodeId(alias, map.id, edge.from), sharedNodeId(alias, map.id, edge.to));
      out[`edge:${m}/${key}`] = {};
    }
  }
  for (const item of array(meta.gameInventedItems).filter(hasId)) out[`item:${item.id}`] = pick(item, ITEM_FIELDS);
  for (const key of WORLD_KEYS) if (meta[key] !== undefined) out[`world:${key}`] = { value: meta[key] };
  return out;
}

/**
 * A record this chat added that the hub already has under another id (both GMs met "Benny") adopts the
 * hub's id through the base's alias table. The chat keeps its own ids, which edges, positions and the Engine's
 * snapshots refer to.
 */
function matchNames(meta, hub, base) {
  const { alias } = base;
  const isNew = (key) => !hub.world[key] && !base.proj[key];
  const claim = (kind, wanted, present) => {
    for (const [key, record] of Object.entries(hub.world)) {
      if (recordKind(key) !== kind || present.has(key)) continue;
      if (wanted(key, valuesOf(record))) return key;
    }
    return null;
  };
  let present = new Set(Object.keys(project(meta, alias)));
  for (const map of nodeMaps(meta)) {
    if (alias.map[map.id] || !isNew(`map:${map.id}`)) continue;
    const name = normalizeName(map.name);
    const key = name && claim("map", (_k, v) => normalizeName(v.name) === name, present);
    if (key) alias.map[map.id] = key.slice(4);
  }
  present = new Set(Object.keys(project(meta, alias)));
  for (const map of nodeMaps(meta)) {
    const m = sharedMapId(alias, map.id);
    for (const node of array(map.nodes).filter(hasId)) {
      const local = `${map.id}/${node.id}`;
      if (alias.node[local] || !isNew(`node:${m}/${node.id}`)) continue;
      const label = normalizeName(node.label);
      const prefix = `node:${m}/`;
      const key = label && claim("node", (k, v) => k.startsWith(prefix) && normalizeName(v.label) === label, present);
      if (key) alias.node[local] = key.slice(prefix.length);
    }
  }
  for (const npc of array(meta.gameNpcs).filter(hasId)) {
    if (alias.npc[npc.id] || !isNew(`npc:${npc.id}`)) continue;
    const name = normalizeName(npc.name);
    const key = name && claim("npc", (_k, v) => normalizeName(v.name) === name, present);
    if (key) {
      alias.npc[npc.id] = key.slice(4);
      present.add(key);
    }
  }
}

/** Push what the chat changed since its base into the hub. Returns the keys the chat itself changed. */
function push(hub, local, base, by, at) {
  const changedByChat = new Set();
  for (const [key, fields] of Object.entries(local)) {
    const known = base.proj[key];
    let record = hub.world[key];
    if (!record) record = hub.world[key] = { seq: ++hub.seq, by, at, fields: {} };
    for (const [field, value] of Object.entries(fields)) {
      const hash = hashOf(value);
      const [baseHash, replaced] = known?.[field] ?? [];
      if (hash === baseHash) continue;
      // The chat wrote back the value Shared World replaced: a stale write or a swipe, not news.
      // ponytail: a real change back to exactly that value is ignored too; a per-turn ordinal would tell them apart.
      if (replaced !== undefined && hash === replaced) continue;
      const cell = record.fields[field];
      let next = value;
      if (cell && field === "notes") next = [...cell.v, ...value.filter((note) => !cell.v.includes(note))];
      else if (cell && field === "discovered") next = cell.v === true || value === true;
      // A record new to this chat that the hub already has (a name match, or both GMs minted one slug) takes
      // the hub's values.
      // ponytail: two different places or people that got one id merge into one; matching on more than the id
      // would keep them apart.
      else if (cell && !known) continue;
      changedByChat.add(key);
      if (cell && hashOf(next) === hashOf(cell.v)) continue;
      record.fields[field] = { v: next, seq: ++hub.seq, by, at };
    }
  }
  return changedByChat;
}

function groupHub(hub) {
  const groups = { npc: new Map(), map: new Map(), node: new Map(), edge: new Map(), item: new Map(), world: new Map() };
  for (const [key, record] of Object.entries(hub.world)) {
    const kind = recordKind(key);
    const id = key.slice(kind.length + 1);
    if (kind === "node" || kind === "edge") {
      const slash = id.indexOf("/");
      const mapId = id.slice(0, slash);
      if (!groups[kind].has(mapId)) groups[kind].set(mapId, []);
      groups[kind].get(mapId).push([id.slice(slash + 1), valuesOf(record)]);
    } else groups[kind]?.set(id, valuesOf(record));
  }
  return groups;
}

const invert = (table) => new Map(Object.entries(table).map(([local, shared]) => [shared, local]));

/** Write the hub into the chat's metadata, keeping everything that is the chat's own. */
export function materialize(meta, hub, alias, { join = false } = {}) {
  const hubParts = groupHub(hub);
  const next = { ...meta };
  for (const key of RETIRED_KEYS) delete next[key];

  const spatialIds = new Set(array(meta.spatialContext?.locations).map((location) => location?.id));
  // A foreign node can point at a spatial location this chat never made: keep the chat's own, or drop it.
  // ponytail: spatialContext is not shared (its revision is tied to the Engine's snapshot rows).
  const spatial = (fields, own) => {
    const out = { ...fields };
    if (out.spatialLocationId !== undefined && !spatialIds.has(out.spatialLocationId)) {
      if (own?.spatialLocationId !== undefined) out.spatialLocationId = own.spatialLocationId;
      else delete out.spatialLocationId;
    }
    return out;
  };

  // NPCs: the chat's order, then the hub's new ones. Reputation and the reputation log stay the chat's.
  const npcRev = invert(alias.npc);
  const seenNpcs = new Set();
  const npcs = [];
  const withShared = (npc, values) => {
    const notes = array(npc.notes);
    return {
      ...npc,
      ...pick(values, NPC_FIELDS),
      notes: [...notes, ...array(values.notes).filter((note) => !notes.includes(note))],
    };
  };
  for (const npc of join ? [] : array(meta.gameNpcs)) {
    if (!hasId(npc)) {
      npcs.push(npc);
      continue;
    }
    const shared = alias.npc[npc.id] ?? npc.id;
    seenNpcs.add(shared);
    const values = hubParts.npc.get(shared);
    npcs.push(values ? withShared(npc, values) : npc);
  }
  for (const [shared, values] of hubParts.npc) {
    // ponytail: a lost record comes back without this party's reputation and log; the base could keep them.
    if (!seenNpcs.has(shared)) npcs.push(withShared({ id: npcRev.get(shared) ?? shared, reputation: 0, notes: [] }, values));
  }
  if (npcs.length || meta.gameNpcs !== undefined) next.gameNpcs = npcs;

  // Maps.
  const mapRev = invert(alias.map);
  // Keyed by shared map and node: two maps can each alias a node to the same shared id.
  const nodeRev = new Map(
    Object.entries(alias.node).map(([local, shared]) => {
      const slash = local.indexOf("/");
      return [`${sharedMapId(alias, local.slice(0, slash))}/${shared}`, local.slice(slash + 1)];
    }),
  );
  const localMaps = join ? [] : nodeMaps(meta);
  const builtMaps = new Map();
  for (const [shared, values] of hubParts.map) {
    const localId = mapRev.get(shared) ?? shared;
    const own = localMaps.find((map) => map.id === localId);
    const localNodeId = (nodeId) => nodeRev.get(`${shared}/${nodeId}`) ?? nodeId;
    const ownNodes = array(own?.nodes);
    const hubNodes = new Map(hubParts.node.get(shared) ?? []);
    const nodes = ownNodes.map((node) => {
      if (!hasId(node)) return node;
      const values = hubNodes.get(sharedNodeId(alias, localId, node.id));
      hubNodes.delete(sharedNodeId(alias, localId, node.id));
      return values ? { ...node, ...spatial(pick(values, NODE_FIELDS), node) } : node;
    });
    for (const [nodeId, nodeValues] of hubNodes) {
      nodes.push({ id: localNodeId(nodeId), ...spatial(pick(nodeValues, NODE_FIELDS)) });
    }
    const nodeIds = new Set(nodes.filter(hasId).map((node) => node.id));
    const edges = [];
    const seenEdges = new Set();
    const addEdge = (from, to) => {
      if (!nodeIds.has(from) || !nodeIds.has(to) || seenEdges.has(edgeKey(from, to))) return;
      seenEdges.add(edgeKey(from, to));
      edges.push({ from, to });
    };
    for (const edge of array(own?.edges)) addEdge(edge?.from, edge?.to);
    for (const [pair] of hubParts.edge.get(shared) ?? []) {
      const [a, b] = pair.split("|");
      addEdge(localNodeId(a), localNodeId(b));
    }
    const firstDiscovered = nodes.find((node) => hasId(node) && node.discovered)?.id ?? nodes.find(hasId)?.id;
    const partyPosition = nodeIds.has(own?.partyPosition) ? own.partyPosition : firstDiscovered;
    builtMaps.set(localId, {
      ...(own ?? { id: localId }),
      ...spatial(pick(values, MAP_FIELDS), own),
      nodes,
      edges,
      ...(partyPosition !== undefined ? { partyPosition } : {}),
    });
  }
  if (builtMaps.size) {
    const maps = [];
    for (const map of join ? [] : array(meta.gameMaps)) {
      if (hasId(map) && builtMaps.has(map.id)) {
        maps.push(builtMaps.get(map.id));
        builtMaps.delete(map.id);
      } else maps.push(map);
    }
    maps.push(...builtMaps.values());
    next.gameMaps = maps;

    if (join && hub.start) {
      const startMap = mapRev.get(hub.start.map) ?? hub.start.map;
      const map = maps.find((entry) => entry.id === startMap);
      if (map) {
        next.activeGameMapId = startMap;
        const node = array(map.nodes).find((entry) => entry.id === hub.start.node);
        if (node) map.partyPosition = node.id;
        if (map.partyPosition !== undefined) next.lastMapPosition = map.partyPosition;
      }
    }
    const activeId = next.activeGameMapId ?? meta.gameMap?.id;
    let active = maps.find((map) => map.id === activeId);
    // A joining chat's own map is gone: without a start to go to, it starts on the first shared map.
    if (!active && join) {
      active = maps.find(hasId);
      if (active) next.activeGameMapId = active.id;
    }
    if (active) next.gameMap = active;
  }

  // Invented items.
  if (hubParts.item.size) {
    const pending = new Map(hubParts.item);
    const items = (join ? [] : array(meta.gameInventedItems)).map((item) => {
      const values = hasId(item) && pending.get(item.id);
      if (!values) return item;
      pending.delete(item.id);
      return { ...item, ...pick(values, ITEM_FIELDS) };
    });
    for (const [id, values] of pending) items.push({ id, ...pick(values, ITEM_FIELDS) });
    next.gameInventedItems = items;
  }

  for (const [key, values] of hubParts.world) if (WORLD_KEYS.includes(key)) next[key] = values.value;
  return next;
}

// ── News ──

const short = (value, limit = 160) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/** What changed in the hub after `sinceSeq`, as short lines. `exclude` drops one player's own changes. */
export function changesSince(hub, sinceSeq, exclude = null) {
  const out = [];
  for (const [key, record] of Object.entries(hub.world)) {
    const kind = recordKind(key);
    if (kind === "edge") continue;
    const values = valuesOf(record);
    const label = values.name ?? values.label ?? key.slice(kind.length + 1);
    if (record.seq > sinceSeq && record.by !== exclude) {
      const text = {
        npc: `New character: ${label}${values.description ? ` (${short(values.description)})` : ""}`,
        map: `New map: ${label}`,
        node: `New place on the map: ${label}`,
        item: `New item known: ${label}${values.summary ? ` (${short(values.summary)})` : ""}`,
        world: "The world overview changed",
      }[kind];
      out.push({ seq: record.seq, by: record.by, at: record.at, text });
    }
    for (const [field, cell] of Object.entries(record.fields)) {
      if (cell.seq <= sinceSeq || cell.by === exclude) continue;
      // The push that created the record already reads as "New …".
      if (record.seq > sinceSeq && cell.by === record.by && cell.at === record.at) continue;
      let text;
      if (kind === "npc" && field === "location") text = `${label} is now at ${short(cell.v)}`;
      else if (kind === "npc" && field === "notes") text = `${label}: ${short(cell.v.at(-1))}`;
      else if (kind === "npc") text = `${label}: ${field} is now ${short(cell.v)}`;
      else if (kind === "node" && field === "discovered") text = `Discovered: ${label}`;
      else if (kind === "world") text = `The world overview changed: ${short(cell.v, 400)}`;
      else if (kind === "item") text = `${label}: ${field} changed`;
      else continue; // map and node layout edits are not news
      out.push({ seq: cell.seq, by: cell.by, at: cell.at, text });
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

// ── Sync ──

/**
 * Sync one chat against the hub. Pure: returns new copies of all three. `join` makes the chat's shared keys
 * the hub's (her chat takes on the existing world); a join into an empty hub seeds it instead.
 */
export function syncWorld({ meta, hub: hubIn, base: baseIn, player, at, join = false }) {
  const hub = structuredClone(hubIn ?? emptyHub());
  const base = structuredClone(baseIn ?? emptyBase());
  const joining = join && Object.keys(hub.world).length > 0;
  if (joining) base.alias = { npc: {}, map: {}, node: {} };
  else {
    matchNames(meta, hub, base);
    push(hub, project(meta, base.alias), base, player, at);
  }
  const written = materialize(meta, hub, base.alias, { join: joining });

  if (!hub.start) {
    const activeId = written.activeGameMapId ?? written.gameMap?.id;
    const map = nodeMaps(written).find((entry) => entry.id === activeId);
    if (map?.partyPosition !== undefined) {
      hub.start = {
        map: sharedMapId(base.alias, map.id),
        node: sharedNodeId(base.alias, map.id, map.partyPosition),
      };
    }
  }

  if (!joining && !join) base.news = [...base.news, ...changesSince(hub, base.lastSeq, player)].slice(-NEWS_LIMIT);
  base.lastSeq = hub.seq;

  // The base remembers what was written, and for a field the write changed, the value it replaced.
  const before = project(meta, base.alias);
  const after = project(written, base.alias);
  const proj = {};
  for (const [key, fields] of Object.entries(after)) {
    proj[key] = {};
    for (const [field, value] of Object.entries(fields)) {
      const hash = hashOf(value);
      const prior = before[key]?.[field];
      const [oldHash, oldReplaced] = baseIn?.proj?.[key]?.[field] ?? [];
      if (prior !== undefined && hashOf(prior) !== hash) proj[key][field] = [hash, hashOf(prior)];
      else if (oldHash === hash && oldReplaced !== undefined) proj[key][field] = [hash, oldReplaced];
      else proj[key][field] = [hash];
    }
  }
  base.proj = proj;
  return { meta: written, hub, base };
}

/** The news block for the Game Master, or null. */
export function newsBlock(news, names) {
  if (!news.length) return null;
  const lines = news.map((item) => `- ${item.text} (${names.get(item.by) ?? "another party"})`);
  return [
    "<shared_world_news>",
    "Other parties share this world and play it on their own. Since your party last looked, this changed:",
    ...lines,
    "These are now true in the world. Bring them in only where your party would plausibly see, hear or learn of them.",
    "</shared_world_news>",
  ].join("\n");
}
