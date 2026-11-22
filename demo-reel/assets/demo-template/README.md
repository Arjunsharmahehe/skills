# .demo-reel — demo videos for this project

Each feature demo is a **flow**: a declarative JSON file in `flows/`.
The agent records it with human-like motion into `out/<flow>/proof.mp4`.

```
.demo/
  flows/*.json        # the demos (edit these)
  schemas/            # editor support for flow JSON
  scripts/
    check-env.mjs     # verify node/ffmpeg/playwright/chromium
    new-flow.mjs      # scaffold flows/<name>.json
    validate.mjs      # static checks (no browser) — must pass before recording
    record.mjs        # run a flow → out/<name>/proof.mp4 + proof.md + proof.srt
    lib/              # human-motion driver + overlay (don't edit per-flow)
  out/<flow>/         # generated: proof.mp4/md/srt, checkpoints, auth, error artifacts
```

Loop: `new-flow` → edit → `validate` → `record` → watch once → `record --from=<step>` for retakes.
