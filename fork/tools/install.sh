#!/usr/bin/env bash
# Install a pushed fork package on the local `marinara` container and restart it, in one call.
# Reads the version and sha from the built catalog, retries while GitHub raw's cache lags (up to ~8 min),
# and will not restart over a recent generation (someone playing) unless --force.
# Usage: fork/tools/install.sh <package-id> [--force] [--container name]
# Never prints ADMIN_SECRET: it is read inside the container.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
id="${1:?usage: install.sh <package-id> [--force] [--container name]}"; shift
force=0; box=marinara
while [ $# -gt 0 ]; do
  case "$1" in --force) force=1 ;; --container) box="$2"; shift ;; *) echo "unknown arg $1"; exit 2 ;; esac
  shift
done
[ "$box" = marinara-wife ] && [ "$force" = 0 ] && { echo "refusing marinara-wife without --force (ask first)"; exit 2; }

read -r version sha < <(python3 -I - "$id" <<'PY'
import glob, json, sys
for path in sorted(glob.glob("fork/catalog/v*/catalog.json"), reverse=True):
    data = json.load(open(path))
    for p in data["packages"] if isinstance(data, dict) else data:
        if (p.get("manifest", {}).get("id") or p.get("id")) == sys.argv[1]:
            print(p.get("manifest", {}).get("version") or p["version"], p["artifact"]["sha256"]); sys.exit()
sys.exit(f"{sys.argv[1]} is not in any fork catalog")
PY
) || exit 1

git fetch -q origin custom-mods
if [ -z "$(git log -1 --format=%h origin/custom-mods -- "fork/artifacts/$id-$version.zip")" ]; then
  echo "fork/artifacts/$id-$version.zip is not on origin/custom-mods yet — commit and push first"; exit 1
fi

echo "installing $id $version (${sha:0:12}) on $box"
for i in $(seq 1 8); do
  out=$(docker exec -i "$box" node - "$id" "$version" "$sha" 2>&1 <<'JS'
const [id, version, sha] = process.argv.slice(2);
const H = { "Content-Type": "application/json", "x-marinara-csrf": "1", "X-Admin-Secret": process.env.ADMIN_SECRET ?? "" };
fetch(`https://127.0.0.1:7860/api/capability-packages/${id}/install`, {
  method: "POST", headers: H, body: JSON.stringify({ expectedVersion: version, expectedArtifactSha256: sha }),
}).then(async (r) => console.log(r.status, (await r.text()).slice(0, 160)));
JS
)
  echo "try $i: ${out:0:170}"
  # A lagging catalog answers with an HTTP error, so those retry; anything else (no container, no node) stops.
  case "$out" in 200*) break ;; [1-5][0-9][0-9]\ *) ;; *) exit 1 ;; esac
  # A 409 that outlasts the cache lag means a reinstall of the same version with a new archive: bump the version.
  [ "$i" = 8 ] && { echo "gave up"; exit 1; }
  sleep 60
done

busy=$(docker logs --since 10m "$box" 2>&1 | grep -cE '"url":"/api/generate')
if [ "$busy" -gt 0 ] && [ "$force" = 0 ]; then
  echo "installed; NOT restarted: $busy generation(s) in the last 10 min. Re-run with --force or restart later."; exit 0
fi
docker restart "$box" >/dev/null && echo "restarted $box"
for _ in $(seq 1 30); do docker logs --since 1m "$box" 2>&1 | grep -qiE 'listening|server started|ready' && break; sleep 3; done
errs=$(docker logs --since 2m "$box" 2>&1 | grep -iE "$id|error" | grep -viE '"level":30' | head -8 | cut -c1-200)
echo "${errs:-no errors in the startup log}"
