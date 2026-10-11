# Custom-Mods Fork (Marinara-Agents)

`custom-mods` is this fork's trunk (`bahaynes/Marinara-Agents`), kept on top of
`upstream/staging` (`Pasta-Devs/Marinara-Agents`). It is the home of our own agent
packages; the Engine fork (`bahaynes/Marinara-Engine`, branch `custom-mods`) keeps
host code only.

## Layout: everything fork-only lives under `fork/`

| Path | What |
| --- | --- |
| `fork/packages/<id>/` | Our package sources (`manifest.json`, `agents.json`, optional `server.mjs`, `README.md`, `tests/`) |
| `fork/build-fork-catalog.mjs` | Builds our artifacts and the fork catalog |
| `fork/artifacts/` | Generated package zips |
| `fork/catalog/v<major>/catalog.json` | Generated catalog the Engine reads |

No upstream file is edited, so rebases never conflict. Package ids must not collide
with upstream ids (the build fails if they do).

## Why a separate catalog

The Engine's `MARINARA_AGENT_CATALOG_URL` override replaces the whole official
catalog, skips the staging preview overlay, and downloads each artifact from the
entry's own URL. So the fork catalog is the upstream lane plus the preview overlay
plus `fork/packages`, with every artifact/icon URL rewritten to this branch. The
catalog and its zips therefore always come from the same commit.

Point an Engine at it with (Engine 2.x reads lane v2):

```
MARINARA_AGENT_CATALOG_URL=https://raw.githubusercontent.com/bahaynes/Marinara-Agents/custom-mods/fork/catalog/v2/catalog.json
```

## Workflow

```bash
node fork/build-fork-catalog.mjs   # after editing fork/packages or after every rebase
```

Bump a package's `version` whenever its payload changes, or installed copies never
see the update.

Rebase: `git fetch upstream && git rebase upstream/staging`, then rerun the build
and commit the regenerated `fork/catalog` and `fork/artifacts`.

Rebuilding an *upstream* package locally (rarely needed) needs `zip` and the
maintainer's timezone for byte-identical artifacts:

```bash
TZ=Europe/Warsaw nix shell nixpkgs#zip -c node scripts/build-agent-catalog.mjs <id>
```

## Prompt rule

Never use story or character names in agent prompts, not even as examples.
