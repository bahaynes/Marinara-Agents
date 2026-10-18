// Inochi2D Puppet Reader server routes and store for Marinara Engine.
// Allows uploading, inspecting, and serving .inp puppet files, metadata, and extracted textures.

import { promises as fs } from "node:fs";
import { join } from "node:path";
import { unpackInp, inspectPuppet, InpParseError } from "./inp-parser.mjs";

export const PACKAGE_ID = "puppet-inp";

export class PuppetError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

/** In-memory cache for parsed puppets to avoid re-unpacking on every asset request */
const puppetCache = new Map();

export async function parseAndCachePuppet(puppetId, buffer) {
  try {
    const { doc, textures } = unpackInp(buffer);
    const summary = inspectPuppet(doc, textures);
    puppetCache.set(puppetId, {
      id: puppetId,
      summary,
      doc,
      textures,
      uploadedAt: new Date().toISOString(),
    });
    return summary;
  } catch (err) {
    if (err instanceof InpParseError) {
      throw new PuppetError(400, `Invalid .inp puppet: ${err.message}`);
    }
    throw err;
  }
}

export function getCachedPuppet(puppetId) {
  const item = puppetCache.get(puppetId);
  if (!item) {
    throw new PuppetError(404, `Puppet "${puppetId}" not found in cache.`);
  }
  return item;
}

export function listCachedPuppets() {
  const list = [];
  for (const [id, item] of puppetCache.entries()) {
    list.push({
      id,
      name: item.summary.meta.name,
      version: item.summary.meta.version,
      counts: item.summary.counts,
      uploadedAt: item.uploadedAt,
    });
  }
  return list;
}

export async function activate(context) {
  const runtime = context.api.runtime;

  const handle = (work) => async (request, reply) => {
    try {
      return reply.send(await work(request.params ?? {}, request.body ?? {}, request.query ?? {}));
    } catch (error) {
      const status = error instanceof PuppetError ? error.statusCode : 500;
      if (status >= 500) runtime.logger?.error?.(error, "Puppet Reader request failed");
      return reply
        .status(status)
        .send({ error: error instanceof PuppetError ? error.message : "Puppet Reader request failed." });
    }
  };

  const release = await context.api.registerPrivilegedRoutes(async (routes) => {
    // List loaded puppets
    routes.get(
      "/puppets",
      handle(() => ({ puppets: listCachedPuppets() })),
    );

    // Get puppet summary & parameters
    routes.get(
      "/puppets/:puppetId",
      handle(({ puppetId }) => {
        const item = getCachedPuppet(puppetId);
        return { summary: item.summary, doc: item.doc };
      }),
    );

    // Load puppet from local filesystem path
    routes.post(
      "/load-path",
      handle(async (_p, body) => {
        const filePath = String(body.path ?? "").trim();
        if (!filePath) throw new PuppetError(400, "Missing 'path' parameter");
        let buffer;
        try {
          buffer = await fs.readFile(filePath);
        } catch (err) {
          throw new PuppetError(404, `Could not read file at "${filePath}": ${err.message}`);
        }
        const puppetId = String(body.id ?? filePath.split(/[/\\]/).pop().replace(/\.inp$/i, "")).trim();
        const summary = await parseAndCachePuppet(puppetId, buffer);
        return { ok: true, id: puppetId, summary };
      }),
    );

    // Serve extracted texture page as PNG
    routes.get("/puppets/:puppetId/textures/:index", async (request, reply) => {
      try {
        const puppetId = request.params?.puppetId;
        const index = parseInt(request.params?.index, 10);
        const item = getCachedPuppet(puppetId);
        if (isNaN(index) || index < 0 || index >= item.textures.length) {
          return reply.status(404).send({ error: `Texture index ${index} out of bounds.` });
        }
        const tex = item.textures[index];
        reply.type("image/png");
        return reply.send(tex.data);
      } catch (err) {
        const status = err instanceof PuppetError ? err.statusCode : 500;
        return reply.status(status).send({ error: err.message });
      }
    });
  });

  return release;
}
