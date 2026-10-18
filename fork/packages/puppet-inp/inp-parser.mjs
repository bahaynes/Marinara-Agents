// Inochi2D (.inp) Binary Parser and Inspector for Marinara Engine
// Specification: TRNSRTS\0 binary container + JSON payload + TEX_SECT textures.

export const INP_MAGIC = "TRNSRTS\0";
export const TEX_MAGIC = "TEX_SECT";

export class InpParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "InpParseError";
  }
}

/**
 * Unpacks an Inochi2D (.inp) binary buffer into the JSON document and texture pages.
 * @param {Buffer} buffer
 * @returns {{ doc: Record<string, any>, textures: Array<{ encoding: number, data: Buffer }> }}
 */
export function unpackInp(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new InpParseError("Expected Buffer input for .inp unpacking");
  }
  if (buffer.length < 24) {
    throw new InpParseError("File is too small to be a valid Inochi2D .inp archive");
  }

  // 1. Verify Magic Header
  const magic = buffer.subarray(0, 8).toString("utf8");
  if (magic !== INP_MAGIC) {
    throw new InpParseError(`Invalid Inochi2D magic header: "${magic}", expected "${INP_MAGIC}"`);
  }

  // 2. Read JSON Payload
  const jsonLength = buffer.readUInt32BE(8);
  if (buffer.length < 12 + jsonLength + 12) {
    throw new InpParseError("Buffer truncated before JSON payload / texture section could be read");
  }

  const jsonStr = buffer.subarray(12, 12 + jsonLength).toString("utf8");
  let doc;
  try {
    doc = JSON.parse(jsonStr);
  } catch (err) {
    throw new InpParseError(`Failed to parse puppet JSON payload: ${err.message}`);
  }

  // 3. Texture Section Magic
  let offset = 12 + jsonLength;
  const texMagic = buffer.subarray(offset, offset + 8).toString("utf8");
  if (texMagic !== TEX_MAGIC) {
    throw new InpParseError(`Invalid texture section header: "${texMagic}", expected "${TEX_MAGIC}"`);
  }
  offset += 8;

  // 4. Read Textures
  const textureCount = buffer.readUInt32BE(offset);
  offset += 4;

  const textures = [];
  for (let i = 0; i < textureCount; i++) {
    if (offset + 5 > buffer.length) {
      throw new InpParseError(`Buffer truncated while reading header for texture #${i}`);
    }
    const dataLength = buffer.readUInt32BE(offset);
    offset += 4;
    const encoding = buffer.readUInt8(offset); // 0 = PNG, 1 = TGA, 2 = BC7
    offset += 1;

    if (offset + dataLength > buffer.length) {
      throw new InpParseError(`Buffer truncated while reading payload for texture #${i}`);
    }
    const data = buffer.subarray(offset, offset + dataLength);
    offset += dataLength;

    textures.push({ encoding, data });
  }

  return { doc, textures };
}

/**
 * Summarizes the puppet hierarchy, parameters, expressions, and texture memory.
 * @param {Record<string, any>} doc
 * @param {Array<{ encoding: number, data: Buffer }>} textures
 */
export function inspectPuppet(doc, textures = []) {
  const meta = doc.meta ?? {};
  const params = doc.param ?? [];
  const nodes = doc.nodes ?? {};

  // Traverse node hierarchy
  const allNodes = [];
  const parts = [];
  function traverse(n) {
    if (!n) return;
    allNodes.push(n);
    if (n.type === "Part") parts.push(n);
    for (const child of n.children ?? []) {
      traverse(child);
    }
  }
  traverse(nodes);

  // Group parameters by category
  const categorizedParams = {
    eyes: [],
    mouth: [],
    head: [],
    expressions: [],
    body: [],
    other: [],
  };

  for (const p of params) {
    const name = String(p.name ?? "");
    const info = {
      name,
      min: p.min ?? [0, 0],
      max: p.max ?? [1, 1],
      defaults: p.defaults ?? [0, 0],
      axisPoints: p.axis_points ?? [[0, 1]],
      bindingsCount: p.bindings?.length ?? 0,
    };

    if (name.startsWith("Eye::") || name.toLowerCase().includes("eye")) {
      categorizedParams.eyes.push(info);
    } else if (name.startsWith("Mouth::") || name.toLowerCase().includes("mouth")) {
      categorizedParams.mouth.push(info);
    } else if (name.startsWith("Head::") || name.toLowerCase().includes("head")) {
      categorizedParams.head.push(info);
    } else if (name.startsWith("Expression::") || name.toLowerCase().includes("expr")) {
      categorizedParams.expressions.push(info);
    } else if (name.toLowerCase().includes("breath") || name.toLowerCase().includes("body")) {
      categorizedParams.body.push(info);
    } else {
      categorizedParams.other.push(info);
    }
  }

  const textureBytes = textures.reduce((acc, t) => acc + t.data.length, 0);

  return {
    meta: {
      name: meta.name ?? "Unnamed Puppet",
      version: meta.version ?? "unknown",
      rigger: meta.rigger ?? "Unknown",
      artist: meta.artist ?? "Unknown",
      copyright: meta.copyright ?? "None",
    },
    counts: {
      nodesTotal: allNodes.length,
      partsTotal: parts.length,
      parametersTotal: params.length,
      texturesTotal: textures.length,
      textureBytesTotal: textureBytes,
    },
    parameters: categorizedParams,
    nodes: {
      rootName: nodes.name ?? "Root",
      rootType: nodes.type ?? "Node",
      partNames: parts.map((p) => p.name),
    },
  };
}
