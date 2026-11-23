# Flow authoring

## Finding selectors

```bash
node scripts/probe.mjs dump                              # all visible text + bounds
node scripts/probe.mjs find --text "Save"                # center of exact match
node scripts/probe.mjs find --contains "thermo"          # substring presence
node scripts/probe.mjs find --checkbox-for "Row title"  # nearest CheckBox by y
```

Prefer text selectors; use fixed `[x, y]` only for:
bottom-nav tabs (stable, no text nodes on some builds), FABs with only a
content-desc, and canvas/webview regions. Re-probe after any APK change.

## Step catalog

| step | does | notes |
|---|---|---|
| `{chapter}` | caption, no action | narrates, not receipts — receipts go in proof.md |
| `{tap:[x,y], label?, settle?}` | `input tap` + log | finger glides here; `settle` ms after (default 800) |
| `{tapText:"…"}` | probe exact text → tap | resolves **live at runtime** |
| `{tapCheckboxFor:"…"}` | nearest CheckBox to row title | dy must be <200px or FAILs |
| `{type:"…", clearDels?}` | DEL-clear + `input text` | spaces auto-escaped; unique `$title` per take |
| `{key:4}` | BACK (hide keyboard) | required before tapping lower-half UI after typing |
| `{swipe:[x1,y1,x2,y2,ms]}` | `input swipe` | finger parks while content moves — reads as a drag |
| `{sleep:n}` | wait | dead air — keep <1500ms or fold into `settle` |
| `{assertVisible/hidden}` | dump + substring match | visible-only dump: swipe the row on-screen first; `{text, reveal: n}` retries with swipes |

`$title` in any string is replaced by `TASK_TITLE` env or `flow.title`.
No em-dashes in any flow text — plain hyphens only (see SKILL.md).
Captions auto-wrap to as many lines as needed at 460px (`lib/caption.py`,
measured in DejaVu Sans 32, never truncated) — but don't rely on it:
keep chapters under ~90 chars, and split a long narration into
consecutive `{chapter}` steps instead of one big caption.

## Worked example

See `flows/create-task.json`: Home → Tasks → FAB → type `$title` → High →
Create → swipe to reveal → assert → tick checkbox → Done filter → assert
present + assert a pending task hidden. 9 taps, ~26s of video.

## Typing gotchas (learned the hard way)

- The Title field keeps its prefill — `clearDels: 25` wipes ~25 chars first.
- Gboard shows a floating toolbar strip while typing; it hides on BACK.
  Don't tap anything until it's gone (the `key` step's `settle` covers it).
- After Create, the new row is usually **below the fold** — `assertVisible`
  / `tapCheckboxFor` take `{text, reveal: n}` to swipe up (up to n times)
  until the row appears; a plain string means no retries.
- After filtering, assert a negative too (`assertHidden` on a row that must
  be gone) — it catches taps that missed the chip.
