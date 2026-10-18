# Engine map for fork packages

Where things live in `/home/bah/git/marinara-engine` (branch `custom-mods`), so a session can jump there
instead of re-exploring. Line numbers drift: grep the quoted anchor, then read a slice around it.
Last checked 2026-10-18 at `dd28c8f33`.

## Game mode (Classic)

| What                                                                                                         | File                                                        | Anchor                                                   |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------------------------------------------------- |
| `/api/game` route prefix                                                                                     | `packages/server/src/routes/index.ts`                       | `prefix: "/api/game"`                                    |
| Next Session: new chat, same `groupId`, `carryMeta` copies metadata                                          | `packages/server/src/routes/game.routes.ts`                 | `app.post("/session/start"`, `carryMeta`                 |
| Map move                                                                                                     | same                                                        | `app.post("/map/move"`                                   |
| Reputation update (re-hydrates metadata; can reset party position to the scene snapshot)                     | same                                                        | `app.post("/reputation/update"`, `buildHydratedGameMeta` |
| `[map_update:…]` tag parsing                                                                                 | `packages/server/src/services/game/map-position.service.ts` | `map_update`                                             |
| GM tags (map_update, reputation) are applied by the **browser** after a reply, so API-driven turns skip them | `packages/client/src/hooks/use-game.ts`                     | `/game/map/move`                                         |

- New NPCs in Classic come mostly from setup and session conclude (up to 3). The NPC addition in
  `generate.routes.ts` is Overworld-only.
- Valid `combatStyle` values: `classic`, `tactical`, `dnd5e`, `triage`.

## Generation and prompt contributors

| What                                                                                                                            | File                                                                   | Anchor                                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------ |
| Game turn calls `prompt-context` contributors with `mode: "game"` and the parsed `chatMeta`. The user message is already saved. | `packages/server/src/routes/generate.routes.ts`                        | `injectCapabilityContexts(`                      |
| Contributor runtime                                                                                                             | `packages/server/src/services/generation/capability-prompt-runtime.ts` | `export async function injectCapabilityContexts` |
| Peek Prompt also runs contributors, so a contributor must not consume state on a dry run                                        | `packages/server/src/routes/generate/dry-run-route.ts`                 | `registerDryRunRoute`                            |

## Packages

| What                                                                                                | File                                                                                 | Anchor                    |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| Install API, `POST /api/capability-packages/<id>/install {expectedVersion, expectedArtifactSha256}` | `packages/server/src/routes/capability-packages.routes.ts`                           | `"/:id/install"`          |
| Package documents (`documents.list/getById/create/update/remove(packageId, id, expectedRevision)`)  | `packages/server/src/services/capability-packages/capability-persistence.service.ts` | `createDocumentStore`     |
| Services per permission (prompt context, tools, routes, agents, …)                                  | `packages/server/src/services/capability-packages/`                                  | `capability-*.service.ts` |

- Installing the same version with a new archive is a 409; bump the version. `fork/tools/install.sh` does
  the install and restart.

## Storage (live instance)

- File-native JSON: `/mnt/faststorage/marinara/data/storage/tables/<table>/*.json`. Package documents live in
  `capability_documents`.
- Read it only with `python3 -I`, read-only. Never write the live store; change things through the API.
