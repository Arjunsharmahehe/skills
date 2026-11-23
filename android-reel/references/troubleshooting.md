# Troubleshooting

- **Finger leads/lags the UI.** `record.mjs` assumes video t=0 ≈ spawn+0.4s.
  On a slow box the encoder takes longer: if every ripple lands early, bump
  the `+ 0.4` constant; verify with
  `python3 -c` amber-centroid measurement on extracted frames (see skill
  history) — pixel evidence, not vibes.
- **Tap misses after scroll.** Dumps go stale mid-animation. The runner
  re-dumps per `tapText`/`assert`, but fixed `[x,y]` taps after a swipe use
  pre-scroll coordinates — re-probe post-scroll positions.
- **`type` writes nothing.** Field wasn't focused: tap it first, keep
  `settle: 900` before typing. Non-ASCII/emoji silently break `input text`.
- **`assertHidden` fails right after a filter tap.** List hadn't settled;
  raise that step's `settle` to 2000+.
- **Duplicate rows confuse `tapCheckboxFor`.** Reuse of a title across takes
  matches the first row in dump order. Fresh `$title` per take (v0.1 has no
  mid-flow resume, only full re-runs).
- **screenrecord stops early.** 90s `--time-limit` in the runner; keep flows
  under ~12 taps. `adb shell screenrecord` needs API 19+ and fails on some
  OEM skins — `check-env.mjs` + a 5s smoke capture catches it.
- **VLC shows giant subtitles.** It auto-loads same-basename `.srt` — turn
  the sub track off or move `proof.srt` aside when previewing.
- **Never `pm clear` to "start fresh"** unless you know the app reseeds
  itself — you can wipe all seed data and be left with an empty app and an
  onboarding flow your script doesn't handle. Prefer unique dummy titles
  per take; if you must reset, check Settings for a seed/demo-data button
  first, and re-deny any notification-permission dialog until it stops
  reappearing before recording.
