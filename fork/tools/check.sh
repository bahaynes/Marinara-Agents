#!/usr/bin/env bash
# Rebuild the fork catalog and run every validation gate in one call.
# Full output goes to a log; the terminal gets one line per stage, plus the failing lines when one fails.
# Usage: fork/tools/check.sh [log-dir]      (default: $TMPDIR or /tmp)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
dir="${1:-${TMPDIR:-/tmp}}"
mkdir -p "$dir"
log="$dir/fork-check-$(date +%H%M%S).log"
: > "$log"

stage() {
  local name="$1"; shift
  echo "=== $name: $*" >> "$log"
  local start=$SECONDS
  if "$@" >> "$log" 2>&1; then
    echo "ok   $name ($((SECONDS - start))s)"
  else
    echo "FAIL $name ($((SECONDS - start))s) — log: $log"
    # The failing stage's output only, minus stack frames.
    awk -v s="=== $name:" 'index($0, s) == 1 { on = 1; next } /^=== / { on = 0 } on' "$log" \
      | grep -vE '^\s+at ' | grep -iE 'fail|error|✖|not ok|expected|actual|assert' | head -25
    exit 1
  fi
}

stage build node fork/build-fork-catalog.mjs
stage lint npm run --silent check
stage lanes node scripts/test-catalog-lanes.mjs
stage locales node scripts/validate-package-locales.mjs
stage catalog node scripts/validate-catalog.mjs
stage release-notes node scripts/tests/catalog-release-notes.regression.mjs
shopt -s nullglob
tests=(fork/packages/*/tests/*.test.mjs)
stage fork-tests node --test "${tests[@]}"
grep -E '^ℹ (tests|pass|fail) ' "$log" | tr '\n' ' '; echo
echo "changed: $(git status --short | wc -l) files — log: $log"
