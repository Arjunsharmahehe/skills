# Troubleshooting — failures we've already met

Each entry: symptom → cause → fix, plus where the tooling already handles it. Check here before debugging from scratch.

## 1. Dropdown opens empty (0 options)

**Symptom:** `pick` fails; a listbox exists in the DOM with no `[role=option]` rows.
**Cause:** After client-side (SPA) navigation the app's data fetches 401 (session not attached) while the shell renders fine. The menu is real but its data never arrived. Verified with plain Playwright clicks — not a driver bug.
**Fix:** Stay UI-first: click the navigation (intent + motion on camera), then `reload` to a clean state and assert content — never `goto` a deep URL to skip the UI (see flow-authoring.md: Navigation). Record the app bug in the step's `_why` note; `reload` once after login to re-establish session. The runner's `menuOpen` check requires a *visible* menu *with options*, so stale/empty menus are retried rather than trusted.

## 2. Click opens a dropdown then instantly closes it

**Symptom:** Menu flashes and disappears; option pick fails on first attempt only.
**Cause:** A fallback `.click()` firing after the real down/up already toggled the control open.
**Fix:** `humanClick` snapshots the DOM before the click and runs the programmatic fallback only if nothing changed (URL, floating layers, body length). Handled in `lib/human.js` — don't add unconditional fallbacks.

## 3. Option found in isolation, not found in the run

**Symptom:** `humanClickText` throws "no match" for text that is visibly on screen.
**Cause:** Almost always a stale or hidden match: global-search comboboxes leave empty `[role="listbox"]` nodes mounted, and UI kits keep closed menus in the DOM. A presence check matches the corpse.
**Fix:** Match the *tightest-wrapping visible* element (length-bounded text, non-zero rect, in viewport) and require visibility + options for menus. Handled in `lib/human.js`. When adding new matchers, copy that discipline.

## 4. Cursor drifts from the mouse, growing over time

**Symptom:** The orange ring trails further behind the real click point as the video progresses; clicks still land correctly.
**Cause:** Page zoom (e.g. 90%) scales `translate(x,y)` on an in-document fixed div by the zoom factor — a 10% error proportional to distance from the top-left.
**Fix:** Overlay lives in a counter-zoom layer (`zoom: 1/z`, computed live from `getComputedStyle(document.documentElement).zoom`), and the dot has no CSS transition (driver steps at ~40–60Hz; a transition makes it chase forever). See `lib/overlay.js`. If you change `zoom`, this keeps working; if you remove the layer, the drift returns.

## 5. Giant duplicate captions in VLC

**Symptom:** Huge white-with-black-outline text over the small burned-in captions.
**Cause:** Not the video — VLC auto-loads a same-basename `.srt` sidecar as a subtitle track. Both render.
**Fix:** Disable the subtitle track in VLC (Subtitle → Sub Track → Disable), or move `proof.srt` aside before previewing. Never "fix" by removing the `.srt` deliverable; warn the user instead.

## 6. Hangs or timeouts on navigation

**Symptom:** Run stalls on `goto`/`reload`, then Playwright times out (default cap was 30s).
**Cause:** Long-lived connections (analytics beacons, SSE, polling) keep "network idle" from ever occurring; occasionally the navigation commit itself stalls.
**Fix:** The runner never waits `networkidle`: `domcontentloaded` (45s cap) + bounded `expect`-selector polling (~12s), with one automatic retry after a 2s settle. Same discipline for login reloads. If both attempts fail, the error names the path and expectation — and the fixed failure path now always writes its report (see §7).

## 7. Resume starts on a blank/wrong page

**Symptom:** `--from` fails immediately with "no match" on a selector the full run finds.
**Cause:** Fresh browser = `about:blank`; the step assumed the previous step's page state.
**Fix:** The runner restores the rewind target's *pre-step snapshot* (URL + storage from before the step ran in the full run), so replay starts from exactly the state the full run saw. `needs`-rewind rebuilds in-memory state on top (draft form picks don't survive reload — verified by probe). If a new app keeps server-side wizard state, add it to `needs`, not to the checkpoint.

## 8. Exports fail but footage exists

**Symptom:** `ffmpeg` errors after a full recording; raw `.webm` sits in `out/`.
**Cause:** Usually an `ffmpeg` filter typo (commas vs colons in `-vf`) — the recording and browser work was fine.
**Fix:** The error report distinguishes export-stage failures (browser already closed: no screenshot, but partial video recovered from the saved raw path). Fix the command, re-run — or transcode the `.webm` by hand; nothing needs re-recording.

## 9. Retake undoes the action (toggle behind a replay path)

**Symptom:** Resume re-records earlier chapters fine, but the end state is wrong — an item removed instead of added, a second record created, a checkbox flipped.
**Cause:** A `click`/`clickText` inside a `needs`-closure re-executes on resume, and the control toggles instead of setting an absolute value.
**Fix:** Never put toggles behind replay paths: navigate to a fresh form/cart and set values absolutely (`fill`, `pick`, `select`), or accept the duplicate and clean up after. The validator warns when a replayable step contains `click`/`clickText`.

## 10. Reading `proof.md` without panicking

**Symptom:** `failed requests` lists `net::ERR_ABORTED` (logos, fonts, beacons) or `console errors` lists 401s — is the demo broken?
**Cause:** Usually not. Aborted static assets are cosmetic (analytics and fonts the page gave up on). 401s *during SPA navigation* are the app losing its session client-side (see §1) — the recording still shows what it shows honestly.
**Fix:** Read receipts as what they are: the appendix, not the verdict. The verdict is the video. If a 401 coincides with an empty dropdown or list on camera, that's app behavior worth reporting upstream — fix the app or the flow, then retake.
