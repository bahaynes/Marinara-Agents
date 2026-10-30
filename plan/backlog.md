# Backlog

Items Ben has approved for later. Each one says which side of the Engine/package boundary it lands on.

## Layout-aware MOSS illustrations (added 2026-10-30)

**Problem.** In-chat MOSS illustrations get the subject count and placement wrong: duplicated familiars, a companion on the wrong side. The MOSS connection's workflow has no layout step, and it zeroes the negative prompt, so text alone cannot fix this.

**Proven.** A one-off workflow adding `CreateBoundingBoxes` and `MOSSImageLayoutPrompt` to the connection's 4-step turbo graph fixed a duplicated dragon on the first try. Boxes are Ideogram-style `[ymin, xmin, ymax, xmax]` on a 0–1000 grid, with `character_boxes: "1, 2"`. The recipe is `image_layout.json` in the engine repo root; the run is in the 2026-10-30 session.

**Shape.** The illustrator writes a short list of boxes alongside its prompt: one per subject, with a caption and rough position. A layout-capable MOSS workflow then turns them into the `bboxes` input. Prompts with no boxes fall back to today's workflow.

**Where it lives.** Decide before building:

- Engine: workflow placeholders such as `%bboxes%`, plus the illustrator's output contract. These are host-owned and could go upstream.
- The `illustrator-2` fork package: box generation in its own prompt, with the Engine only passing them through.
