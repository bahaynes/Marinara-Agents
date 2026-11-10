#!/usr/bin/env node

// Helper script to synchronize `fork/config/5e-2024-sources.json` with your owned
// books on D&D Beyond or inspect available sourcebooks in the 5etools data dump.
//
// Usage:
//   node scripts/sync-ddb-owned-sources.mjs --list
//   node scripts/sync-ddb-owned-sources.mjs --from-ddb path/to/ddb-sources.json
//   node scripts/sync-ddb-owned-sources.mjs --enable XPHB,XDMG,XMM,EFA,TCE
//   node scripts/sync-ddb-owned-sources.mjs --disable AI
//
// Browser snippet for https://www.dndbeyond.com/sources or https://www.dndbeyond.com/account/marketplace:
//   copy(JSON.stringify([...document.querySelectorAll('a[href*="/sources/dnd/"], a[href*="/sources/"]')].map(a => ({ title: a.textContent.trim(), href: a.getAttribute('href') })), null, 2))

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const configPath = join(repoRoot, "fork/config/5e-2024-sources.json");

async function loadConfig() {
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw);
}

async function saveConfig(config) {
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  console.log(`Updated ${configPath}`);
}

async function main() {
  const args = process.argv.slice(2);
  const config = await loadConfig();
  const dataDir = process.env.FIVE_E_TOOLS_DATA_DIR || config.dataDir;

  if (args.includes("--help") || args.length === 0) {
    console.log(`
D&D Beyond Owned Sources Sync Utility

Options:
  --list                     List all configured books and their owned status
  --from-ddb <file.json>     Import owned books from a D&D Beyond scraper JSON file
  --enable <SRC,SRC,...>     Set owned=true for the comma-separated 5etools source codes
  --disable <SRC,SRC,...>    Set owned=false for the comma-separated 5etools source codes
  --data-dir <path>          Update default 5etools data directory

Browser Console Snippet:
  Run this snippet while logged in at https://www.dndbeyond.com/sources to extract your owned library:
  copy(JSON.stringify([...document.querySelectorAll('a[href*="/sources/dnd/"]')].map(a => a.textContent.trim()).filter(Boolean), null, 2))
`);
    return;
  }

  if (args.includes("--list")) {
    console.log(`\nConfigured 5etools Sourcebooks (data: ${dataDir}):\n`);
    const entries = Object.entries(config.books);
    for (const [code, info] of entries) {
      const mark = info.owned ? "[\x1b[32mOWNED\x1b[0m]" : "[\x1b[90mEXCLUDED\x1b[0m]";
      console.log(`  ${code.padEnd(8)} ${mark}  ${info.title} (${info.group})`);
    }
    const ownedCount = entries.filter(([, info]) => info.owned).length;
    console.log(`\nTotal: ${ownedCount} / ${entries.length} sourcebooks enabled.\n`);
    return;
  }

  const enableIdx = args.indexOf("--enable");
  if (enableIdx !== -1 && args[enableIdx + 1]) {
    const codes = args[enableIdx + 1].split(",").map((s) => s.trim().toUpperCase());
    for (const code of codes) {
      if (config.books[code]) {
        config.books[code].owned = true;
        console.log(`Enabled: ${code} (${config.books[code].title})`);
      } else {
        console.warn(`Warning: Unknown 5etools source code: ${code}`);
      }
    }
    await saveConfig(config);
    return;
  }

  const disableIdx = args.indexOf("--disable");
  if (disableIdx !== -1 && args[disableIdx + 1]) {
    const codes = args[disableIdx + 1].split(",").map((s) => s.trim().toUpperCase());
    for (const code of codes) {
      if (config.books[code]) {
        config.books[code].owned = false;
        console.log(`Disabled: ${code} (${config.books[code].title})`);
      } else {
        console.warn(`Warning: Unknown 5etools source code: ${code}`);
      }
    }
    await saveConfig(config);
    return;
  }

  const ddbIdx = args.indexOf("--from-ddb");
  if (ddbIdx !== -1 && args[ddbIdx + 1]) {
    const raw = await readFile(resolve(process.cwd(), args[ddbIdx + 1]), "utf8");
    const ddbData = JSON.parse(raw);
    const titles = Array.isArray(ddbData) ? ddbData.map((x) => (typeof x === "string" ? x : x.title || "")) : [];

    const norm = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, "");

    let matched = 0;
    for (const [code, info] of Object.entries(config.books)) {
      const bookNorm = norm(info.title);
      const isOwned = titles.some((t) => {
        const tn = norm(t);
        return tn.includes(bookNorm) || bookNorm.includes(tn);
      });
      if (isOwned) {
        info.owned = true;
        matched++;
      }
    }
    console.log(`Matched and enabled ${matched} owned sourcebooks from D&D Beyond export.`);
    await saveConfig(config);
    return;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
