// Fork-only catalog builder (custom-mods). See CUSTOM_MODS.md.
//
// The Engine's MARINARA_AGENT_CATALOG_URL override replaces the whole official
// catalog, skips the staging preview overlay, and downloads each artifact from
// the entry's own URL. So this writes fork/catalog/v<major>/catalog.json as:
//   upstream lane + upstream preview overlay + fork/packages/*,
// with every artifact/icon URL pointing at this fork's custom-mods branch so the
// catalog and its zips always come from the same commit.
//
// Upstream files are never touched; rerun after every rebase onto upstream/staging.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeterministicZip } from "../scripts/deterministic-zip.mjs";

const forkRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(forkRoot, "..");
const UPSTREAM_RAW = "https://raw.githubusercontent.com/Pasta-Devs/Marinara-Agents/main/";
const FORK_RAW = "https://raw.githubusercontent.com/bahaynes/Marinara-Agents/custom-mods/";
const FORK_TREE = "https://github.com/bahaynes/Marinara-Agents/blob/custom-mods/";
// Not shipped in the artifact: docs and the package's own tests.
const NON_PAYLOAD = new Set(["manifest.json", "README.md", "CHANGELOG.md"]);

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const exists = (path) =>
  access(path).then(
    () => true,
    () => false,
  );

async function listPayload(dir, base = dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "tests") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listPayload(path, base)));
    else if (!(dir === base && NON_PAYLOAD.has(entry.name))) files.push(relative(base, path).split("\\").join("/"));
  }
  return files.sort();
}

function majorOf(version) {
  return Number(version.split(".")[0]);
}

function rewriteUrls(entry) {
  const json = JSON.stringify(entry).replaceAll(UPSTREAM_RAW, FORK_RAW);
  return JSON.parse(json);
}

// Build fork packages.
const forkPackagesDir = join(forkRoot, "packages");
const forkArtifactsDir = join(forkRoot, "artifacts");
await mkdir(forkArtifactsDir, { recursive: true });
const forkEntries = [];
for (const id of (await readdir(forkPackagesDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()) {
  const dir = join(forkPackagesDir, id);
  const manifestPath = join(dir, "manifest.json");
  const source = await readJson(manifestPath);
  if (source.id !== id) throw new Error(`fork/packages/${id} contains manifest id ${source.id}`);
  const payload = await listPayload(dir);
  const buffers = new Map();
  for (const path of payload) {
    let data = await readFile(join(dir, path));
    // Normalize JSON payloads the way the upstream builder does.
    if (path.endsWith(".json")) data = Buffer.from(`${JSON.stringify(JSON.parse(data.toString("utf8")), null, 2)}\n`);
    buffers.set(path, data);
  }
  const manifest = {
    ...source,
    files: payload.map((path) => ({ path, sha256: sha256(buffers.get(path)), bytes: buffers.get(path).byteLength })),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const zip = createDeterministicZip([
    { name: "manifest.json", data: manifestBuffer },
    ...payload.map((path) => ({ name: path, data: buffers.get(path) })),
  ]);
  const artifactName = `${id}-${manifest.version}.zip`;
  await writeFile(join(forkArtifactsDir, artifactName), zip);
  const agents = manifest.entrypoints?.agents ? JSON.parse(buffers.get(manifest.entrypoints.agents)) : [];
  const category = ["writer", "tracker", "misc"].includes(agents[0]?.category) ? agents[0].category : "misc";
  const hasIcon = await exists(join(forkRoot, "artwork", `${id}.png`));
  forkEntries.push({
    manifest,
    category,
    ...(hasIcon ? { iconUrl: `${FORK_RAW}fork/artwork/${id}.png` } : {}),
    artifact: { url: `${FORK_RAW}fork/artifacts/${artifactName}`, sha256: sha256(zip), bytes: zip.byteLength },
    documentationUrl: (await exists(join(dir, "README.md")))
      ? `${FORK_TREE}fork/packages/${id}/README.md`
      : `${FORK_TREE}CUSTOM_MODS.md`,
  });
}

// Merge with each upstream lane.
for (const lane of (await readdir(join(repoRoot, "catalog"))).filter((name) => /^v\d+$/.test(name)).sort()) {
  const major = Number(lane.slice(1));
  const published = await readJson(join(repoRoot, "catalog", lane, "catalog.json"));
  const previewPath = join(repoRoot, "catalog", "preview", lane, "catalog.json");
  const preview = (await exists(previewPath)) ? await readJson(previewPath) : { packages: [] };
  const byId = new Map();
  for (const entry of [...published.packages, ...preview.packages]) byId.set(entry.manifest.id, rewriteUrls(entry));
  for (const entry of forkEntries) {
    const { min, maxExclusive } = entry.manifest.engine;
    // In this lane when some <major>.x.y satisfies min <= v < maxExclusive.
    if (majorOf(min) > major || (maxExclusive && (majorOf(maxExclusive) < major || maxExclusive === `${major}.0.0`)))
      continue;
    if (byId.has(entry.manifest.id)) {
      throw new Error(`Fork package ${entry.manifest.id} collides with an upstream package of the same id`);
    }
    byId.set(entry.manifest.id, entry);
  }
  const catalog = {
    ...published,
    packages: [...byId.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)),
  };
  const out = join(forkRoot, "catalog", lane);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(
    `fork catalog ${lane}: ${catalog.packages.length} packages (${forkEntries.length} fork, ${preview.packages.length} preview)`,
  );
}
