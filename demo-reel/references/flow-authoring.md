# Flow authoring

A flow is `flows/<name>.json`: a title card, a base URL, and an ordered list of steps. The runner executes top to bottom; each step shows its caption, runs its actions, then becomes a chapter in `proof.srt` and a checkpoint for retakes.

```json
{
  "name": "purchase-order",
  "title": "Creating a purchase order",
  "subtitle": "DemoERP · recorded proof",
  "task": "login → new purchase order → view in list",
  "baseUrl": "https://demo-erp.fukumean.me",
  "zoom": 90,
  "steps": [
    {
      "id": "supplier",
      "chapter": "pick supplier",
      "caption": "Supplier: Bearing House (SUP-002)",
      "needs": ["new-form"],
      "actions": [
        { "do": "scrollTo", "selector": "#po-supplier" },
        { "do": "pick", "trigger": "#po-supplier", "option": "SUP-002" }
      ]
    }
  ]
}
```

Top-level: `name` (outputs go to `out/<name>/`), `title`/`subtitle` (opening card, ~1.8s, skipped on resume), `task` (one-liner for `proof.md`), `baseUrl` (all `goto` paths append to it), `zoom` (page zoom percent, default 90 — frames more content at the same 720p), `font` (caption stack, default Inter/Arial).

Steps: `id` (stable; used by `--from` and `needs`), `chapter` (srt entry; defaults to `caption`), `caption` (bottom-center narration — see narration.md), `needs` (ids whose effects must exist; resume rewinds through these transitively), `actions` (executed in order).

`${vars}` interpolate in `text`, `caption`, and assert fields. Set them with `extract` (e.g. pull a created record's id out of the URL for later captions and asserts).

## Action catalog

| `do` | Params | Notes |
|---|---|---|
| `goto` | `path` (must start with `/`), `expect` (selector to wait for), `direct?` (marks a sanctioned exception — requires a `_why` note on the step) | Entry page load, and marked exceptions only. Always give `expect` — it's the bound on load dead-air. |
| `reload` | — | Full reload. Use after login when session needs re-establishing. |
| `click` | `selector` | Bezier mouse + real down/up + ripple. Falls back to `.click()` only if the real click had no visible effect (keeps toggles from open→close double-firing). |
| `clickText` | `text`, `exact?` | Clicks the tightest-wrapping visible element containing the text — for buttons and options without stable selectors. |
| `pick` | `trigger`, `option` | Dropdown/combobox: `trigger` is a selector, or `text:<label>` for text triggers. Opens the menu, verifies a *visible* menu with options, clicks the `[role=option]` row, verifies by reading the trigger back, retries ×3. |
| `type` | `selector`, `text` | Human typing: focus, select-all, 45–110ms/char, pauses on space/punctuation. For search boxes and logins. |
| `fill` | `selector`, `text` | Same timing, for qty/rate-style fields (replaces instead of appending). |
| `scrollTo` | `selector` | Eased scroll landing the element at ~40% viewport height + 350ms settle. |
| `scroll` | `to`: px, `"top"`, or `"NN%"` of page height | Eased read-scrolls. |
| `wait` | `ms` | Fixed pause. >5s warns in validate — prefer `assert` so slow loads don't become dead air and fast loads don't waste time. |
| `caption` | `text` | Mid-step narration swap (fade out → swap → fade in). |
| `assert` | `urlIncludes?`, `urlExcludes?`, `textIncludes?`, `visible?` | Polls ~12s. Failure names the condition, url, and step — this is what makes error reports actionable. Assert after every navigation and every save. |
| `extract` | `as`, `from`: `url`\|`text`, `match` (regex), `selector?` (for text) | Capture dynamic values (record ids, totals) into `${vars}`. First capture group wins, else full match. |
| `select` | `selector`, one of `value`/`label`/`index` | Native `<select>` dropdowns. Moves the mouse there first (cursor story), then selects programmatically — native menus are OS-rendered, `pick` is for custom menus only. |

## Navigation — the UI is the demo

A viewer can feel a URL jump: no mouse journey, no hover states, just a teleport cut. Worse, it stops demonstrating the product — the navigation *is* part of the feature. So:

- **Default: click through the UI.** Sidebar links, nav items, buttons, breadcrumbs. Assert the URL changed afterwards (`assert urlIncludes`) — that's how the flow proves the navigation worked.
- **First step `goto` is the entry.** Loading the app's front door (or login page) is the one arrival the viewer expects.
- **Exceptions get marked, never smuggled.** Two are sanctioned: (1) pages with no UI path in the demo's context, like an admin console you were handed as a link; (2) client-side routing that provably breaks data loading (see troubleshooting §1/§6). Mark them with `"direct": true` on the action and a `_why` note on the step explaining why the UI path can't be used. The validator warns on unmarked deep `goto`s and on marked ones missing the note.
- **Broken SPA routing: click first, `reload` second.** When the app's own navigation leaves data unfetched, still perform the human click (intent + motion on camera), then `reload` to a clean state and assert content. The viewer reads it as a normal page load; the `_why` note records the app bug for the developer.

## Selectors — scope ambiguous inputs

Probing often surfaces inputs the driver can't address by placeholder alone: shared placeholders (`Type for hints...` × 2), icon-only buttons, repeated labels. Rules:

- **Prefer stable ids and `data-test` attributes.** Then visible text (`clickText`), then structure.
- **Scope via the parent context** when text repeats: `.oxd-form .oxd-grid-item:first-child input` beats `nth=` indexes, which break on layout changes. Describe *which one* in plain language first ("the Employee Name box — first grid item in the form"), then encode it.
- **Verify count==1 in your probe** before writing the flow: log how many elements match and their nearby labels. A selector matching two elements today matches the wrong one tomorrow — the validator flags brittle patterns, but your probe is the real gate.

## `needs` and resume semantics

`--from=<id>` rewinds through the transitive closure of `needs` to the earliest one, restores that step's *pre-step snapshot* (page URL + session storage as of before the step ran in the full run), and re-records forward to the end. Retakes write to `out/<name>/retakes/<step>/` — never over the deliverable — and `scripts/stitch.mjs` assembles the final `proof.mp4`. You do not need to read the runner source — this is the whole contract.

Two facts set the frame:

1. **Snapshots make resume state-correct by default.** The restored snapshot predates the step, so replayed actions — even toggles — act on exactly the state the full run saw. Session comes from stored auth (`auth.json` is a full storageState: cookies *and* localStorage), so login never re-runs. `${vars}` restore from the run's latest values.
2. **Checkpoints refresh on every full run** (`checkpoints.json` v3 + per-step `auth-<step>.json`, pinned to the flow by hash). Edit the flow and the next resume refuses until one fresh full run re-baselines. A stale version forces one fresh record.

Rules that follow:

- **Empty `needs` is safe *and* correct.** With snapshots, any step can resume standalone — the common case, especially for click-chains where position restore puts you on the right page with the right session. Absence of `needs` is a valid, reviewable choice.
- **Use `needs` for narrative rebuild, not state repair.** If retaking a warehouse pick reads better with the supplier pick re-shown first, declare it — the fragment re-records a complete mini-story instead of starting mid-form. Form picks are the classic case: the picks survive in the snapshot either way, but the viewer benefits from seeing them made.
- **Never put a toggle behind a replay path.** Inside a `needs` closure, a second click on an add/remove toggle *undoes* the action. Prefer idempotent actions on rebuilt state (navigate, then set values absolutely with `fill`/`pick`/`select` — never toggle). If the app only offers a toggle, rebuild around it (fresh form, fresh cart) instead of re-clicking it. The validator warns on replayable non-navigating clicks.
- **Mark record-creating steps with `"creates": true`.** Save/submit steps that create server-side records will duplicate on retake — the validator flags this so the author consciously accepts it or adds cleanup.
- **Prefer asserting URLs and headings over button labels.** Labels repeat across the page ("Remove" matches five rows); URLs and headings identify state. Weak asserts pass on the wrong screen and the video lies.

Session (`out/<name>/auth.json`) saves after login and refreshes after every step, so retakes never re-authenticate.
