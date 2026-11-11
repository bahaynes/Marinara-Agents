# Changelog

## 2.0.0

- Merges Timeline & Chronology Anchor into this agent; the anchor package is removed.
- The timeline now reaches the story model: a prompt-context block each turn (before, the tracker's output
  was saved but never injected).
- The clock is stateful and computed by the package: the extractor reports minutes passed and milestones
  begun or ended, and the package sums time and computes every "began N ago". Swipe- and branch-aware.
- Uses World State's date and time as "now" when that tracker is active.
