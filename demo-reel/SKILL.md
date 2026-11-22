---
name: demo-reel
description: Record client-ready demo videos of web features with an agent driving a real browser using human-like motion. Use when the user wants a demo video, proof-of-work recording, feature walkthrough, or client deliverable showing a web flow working. Scaffolds a .demo/ directory (flows as JSON, record/validate scripts), validates statically, records to proof.mp4 with narration captions, and supports chapter-level retakes plus error reports with partial footage.
---

# demo-reel — demo videos your agent records for you

The user just shipped a feature and needs to *show* it working — to a client, a manager, a stakeholder. Manual screen recording is the pain: fumbled clicks ruin whole takes, narration rambles, cursors vanish. This skill makes the user's own AI do the recording instead: it drives the real app in a real browser with human-smooth motion, narrates with burned-in captions, and hands back an mp4 worth sending.

The agent never improvises motion. It writes a declarative **flow** (JSON), validates it without a browser, records it, watches once, and retakes by chapter — never by full re-record.

## Core principles

- **Narrate, don't log.** Captions describe the *feature* for a non-technical viewer ("Creating a purchase order"), never the agent's clicks ("clicked Save"). Console errors, SHAs and step logs belong in `proof.md`, never in the video.
- **Validate before record.** `validate.mjs` must pass before any recording run. A flow that fails static checks will waste minutes of browser time.
- **Retake chapters, never full takes.** A fumbled chapter is fixed with `--from=<step>` (rewind + pre-step snapshot restore, auth reused), which writes a fragment to `retakes/`; `stitch.mjs` then assembles the final deliverable. Re-recording from scratch is failure.
- **Every run ends in artifacts, never in silence.** Success writes `proof.mp4 + proof.md + proof.srt`. Failure writes `error-report.md + error.png + partial.mp4` with the exact resume command. A crash with no artifacts is a bug in the run, report it as one.
- **Watch once before sending.** After every record, extract frames (`ffmpeg -vf fps=1`) and actually look: cursor on the control it clicked, captions readable, no loading-spinner dead air. Fix and retake before calling it done.
- **Real browser, real URL, no fakes.** Navigate like the user: click links, buttons, and menus. The entry page load is the only URL a viewer should ever see you 'arrive' on. Never mock the app, never edit footage to hide app behavior.

## Setup (once per project)

All work happens inside `<project>/.demo/`. If it doesn't exist, scaffold it from this skill's template:

```bash
mkdir -p <project>/.demo
cp -r <skill-base-dir>/assets/demo-template/* <project>/.demo/
cd <project>/.demo && npm install && node scripts/check-env.mjs
```

`check-env.mjs` verifies node 18+, ffmpeg, and a launchable Playwright Chromium. Fix whatever it flags before continuing — do not proceed on a red env. Keep cwd at `<project>/.demo` for every script command below.

## Workflow

**1. Learn the flow.** Open the app in a browser (or probe with a throwaway Playwright script): note the exact selectors, dropdown option texts, validation rules (e.g. "rates within ±10%"), and what a saved record's URL looks like. Prefer stable ids and visible text over auto-generated classes. Record these facts — they become the flow.

**2. Write the flow.** `node scripts/new-flow.mjs <name>`, then edit `flows/<name>.json`. One step per viewer-beat (login → list → form → each field group → save → verify), each with a narration `caption`. Declare `needs` where a retake should re-show setup beats (the runner rewinds transitively and restores pre-step snapshots, so empty `needs` is safe). See [reference/flow-authoring.md](reference/flow-authoring.md) for the action catalog; [reference/narration.md](reference/narration.md) for caption craft.

**3. Validate.** `node scripts/validate.mjs --flow <name>`. Fix every ERROR. Treat WARNs as guilty until proven innocent (long captions, brittle selectors, blind waits). Recording on a red validate is forbidden.

**4. Record.** `node scripts/record.mjs --flow <name>`. The runner shows a title card, executes steps with human motion (eased scroll, bezier mouse, variable typing), saves session + checkpoints per step, and exports 720p `proof.mp4` (<5MB target) with `proof.md` receipts.

**5. Watch once.** Extract frames and inspect: cursor alignment (must sit *on* the control), caption readability, no multi-second spinners. If a chapter is bad, retake it: `node scripts/record.mjs --flow <name> --from=<step-id>` writes a fragment to `retakes/<step>/` (auth is reused, state restores automatically), then `node scripts/stitch.mjs --flow <name>` assembles the final deliverable. Do not accept a video you haven't looked at.

**6. Deliver.** Hand over `out/<name>/proof.mp4`. Mention `proof.md` as the receipts appendix. Never send `error-report.md` or console errors to the client.

## Commands

| Command | What it does |
|---|---|
| `node scripts/check-env.mjs` | Verify toolchain. Run first, and after any env change. |
| `node scripts/new-flow.mjs <name>` | Scaffold `flows/<name>.json`. Never hand-write the boilerplate. |
| `node scripts/validate.mjs --flow <name>` / `--all` | Static gate. Must pass before recording. |
| `node scripts/record.mjs --flow <name>` | Full record. Login runs once; session persists. |
| `node scripts/record.mjs --flow <name> --from=<id\|n>` | Chapter retake into `out/<name>/retakes/<step>/` — deliverable untouched. Then stitch. |
| `FAIL_AT=<step> node scripts/record.mjs --flow <name>` | Test hook: simulate a failure to verify the error path. |
| `node scripts/stitch.mjs --flow <name> [--retake <id>]` | Assemble final `proof.mp4` from the original + latest retake. Originals kept as `proof.prev.*`. |

## Hard rules

- Never record without a passing validate. Warnings are guilty until proven innocent — especially navigation and toggle warnings. Never invent selectors — probe the live app first.
- Never put errors, SHAs, timings, or debug text in captions or titles. The video is for the client; receipts live in `proof.md`.
- Never ship `proof.srt` next to the mp4 when the viewer uses VLC — it auto-loads same-basename subtitles and double-renders giant captions over the burned-in ones. Move it aside or warn the user.
- Never use raw Playwright motion in flows — the `lib/` driver exists because `mouse.move`, `scrollIntoView`, and `fill` look robotic on video.
- Never `goto` a deep URL to skip UI navigation. Special cases (admin pages with no UI path, provably broken client-side routing) get there by being marked special: `"direct": true` on the action plus a `_why` note on the step — never silently.
- Never leave a failed run without reading its `error-report.md` — it contains the resume command. Fix, then `--from` the failed step.
- Never reuse a stale `error.png`/`partial.mp4`: the runner clears them at start; if you see one, it's from the latest run.
- Keep videos honest: if the app 401s, spins, or misbehaves on camera, that's app behavior — report it, don't cover it with edits. Fix the app or the flow, then retake.

## When it breaks

Load [reference/troubleshooting.md](reference/troubleshooting.md) on any failure — it documents every known failure mode (SPA-auth 401s, hidden-but-mounted dropdowns, toggle double-fire, zoom coordinate drift, `networkidle` hangs) with symptom → cause → fix. If the failure isn't there, add it after fixing: the skill learns.

Base directory for this skill: the directory containing this SKILL.md. Template lives at `assets/demo-template/`; references at `reference/`.
