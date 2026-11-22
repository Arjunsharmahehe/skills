# Narration — captions for a client, not logs for a developer

The viewer is non-technical and wasn't in the room. Every caption answers "what am I looking at and why should I care." The agent's click log is never the caption.

## Rules

- **Feature language, present tense.** "Creating a purchase order", "Saving as Draft", "PO-2026-00013 · top of the list". Never "clicked Save", "typed UUID", "assert passed".
- **One line, ≤140 chars.** The pill truncates with ellipsis past its width; validate warns. If it doesn't fit, it's two steps.
- **Name things the way the client does.** Supplier names and record ids ("Bearing House", "PO-2026-00013") beat codes alone. `${vars}` from `extract` exist for this — capture the id at save time, caption it afterwards.
- **Pace for civilians.** A caption change needs a beat to register: the runner's fade-swap plus the action's own settle usually suffices; add a short `wait` after dense moments (totals rendering, toasts appearing).
- **Title card sets context once.** "<Feature> / <App> · recorded proof". It fades before captions start — they must never overlap.

## Never in the video

Console errors, SHAs, timings, step ids, debug text, "retake" language. The video shows the feature working; `proof.md` carries receipts for the developer. Showing a client your 401s actively undermines the demo.

## Step shape

One viewer-beat per step: a caption, one coherent motion (scroll → act → settle), then the next beat. If you can't caption it in a line, split it. If two captions say the same thing, merge the steps. Chapters in the exported `.srt` mark where each beat *starts* (when its caption appears), for anyone scrubbing the timeline.
