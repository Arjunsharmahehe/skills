# android-reel

Record client-ready Android demo videos driven by real taps — with an **amber
finger** that glides between taps and ripples on contact, matching the
[demo-reel](../demo-reel/SKILL.md) web cursor language. Output is always
`proof.mp4` (720x1600) + `proof.md` + `proof.srt`.

## Working directory

Scaffold once per project (keeps web + mobile side by side):

```bash
cp -r <this-skill>/assets/android-template <project>/.demo-android/
cd <project>/.demo-android
node scripts/check-env.mjs && node scripts/validate.mjs flows/create-task.json
```

`ANDROID_SERIAL` selects the target (default `emulator-5554`).

## The loop (every run)

1. **Probe the live app first.** `node scripts/probe.mjs dump`, then
   `node scripts/probe.mjs find --text "Exact label"` /
   `--checkbox-for "Row title"`. Never hand-write coordinates you haven't
   probed — layouts shift between builds. A probe must resolve exactly one
   node before the flow may use it.
2. **Author the flow** (`flows/<name>.json`, see
   [flow-authoring](references/flow-authoring.md)): entry launch only,
   in-app movement is taps. `node scripts/validate.mjs` must pass.
3. **Dry run, then record.**
   `TASK_TITLE="…" node scripts/record.mjs --dry flows/x.json` (executes for
   real, no video) → `node scripts/record.mjs flows/x.json` →
   `node scripts/post.mjs`. Every green run ends in
   `out/proof.mp4 + proof.md + proof.srt`.
   `--dry` still taps the real app and writes real state, so dry with a
   throwaway title (`TASK_TITLE="… dry run"`) and record with the receipt
   title — otherwise dry + record create duplicate rows.
   All paths resolve under the scaffold root: `flows/`, `out/`. The title
   card and `proof.md` copy come from the flow's `meta` block
   (`cardTitle` — `|` splits two lines — `cardSubtitle`, `proofTitle`) —
   never hardcode flow names in scripts.
4. **Watch the frames** before showing anyone:
   `ffmpeg -ss <t> -i out/proof.mp4 -frames:v 1 f.png` at each chapter
   boundary. The finger must touch the control *as* it reacts — if it leads
   or lags by more than a beat, the run is a retake. Times in
   `events.json`/`chapters.json` are video-relative (raw footage); proof
   times add the 2s title card.

## The finger

The dot is **burned in post**, not captured: `record.mjs` logs every tap
with a video-relative timestamp, `post.mjs` renders `lib/finger_overlay.py`
(30fps RGBA: easeInOutCubic glides, expanding ripple ring on contact, amber
`#f59e0b` flat ring like the web cursor — dim while moving, bright for
~0.3s of finger-down on each tap) and composites it over the `screenrecord`
capture with a minimalist title card (flow name only) and bottom-pill
captions on a 50%-opacity black box. `show_touches` is enabled as a backup
dot but the ripple is the source of truth — never depend on the OEM dot
alone.

## Hard rules

- **UI-first, entry-only launch.** The runner `force-stop`s + launches the
  package once. Mid-flow `am start` into another activity is forbidden unless
  the step is `direct:true + _why` (same bar as demo-reel's `direct` rule).
- **No raw coordinates without a probe.** Fixed `[x, y]` taps are allowed
  only for nodes the hierarchy dump can't see (canvas, webview); text and
  checkbox taps must use `tapText` / `tapCheckboxFor` so they resolve live.
- **Every run ends in artifacts.** Green: proof triple. Red: keep `raw.mp4`
  + the assert message — that *is* the bug report.
- **Typing is ASCII-only** (`adb input text` limits); keep titles to
  `[a-zA-Z0-9 .,!?@_:-]`. Dismiss the keyboard (`key 4`) before tapping
  anything in the lower half.
- **No em-dashes in video-visible text.** Chapters, title card, and proof
  copy use plain hyphens `-`, never `—`/`–`: device fonts render them
  inconsistently and they scream template. `validate.mjs` WARNs on them.
- **Captions must never spill, clip, or truncate.** Rules for every chapter:
  - Keep each chapter under ~90 chars (`validate.mjs` WARNs above that).
  - If one idea needs more words, split it into consecutive `{chapter}`
    steps instead of one long caption — each step shows its own caption
    while the screen holds, so a three-sentence narration becomes three
    short captions, never one wall of text.
  - Never truncate, ellipsize, or fade-cut caption text to make it fit.
    The pipeline (`lib/caption.py` + per-line `drawtext`) wraps anything
    over 460px onto more lines and centers each line on its own width, but
    that is a safety net, not a license for long captions.
  - Verify on frames: extract a frame per chapter and check the pill sits
    fully inside the video, clear of the nav bar and clear of FABs.
- Retakes in v0.1 are **full re-runs** (no mid-flow resume yet). Use a fresh
  `$title` per take so duplicate rows can't confuse `tapCheckboxFor`.

## Known limits (v0.1)

- Template geometry targets a 1080x2400 AVD (Medium_Phone class). Other
  densities need re-probed coordinates; the overlay scales with the video.
- No Appium, no root, sample/debuggable apps only.
