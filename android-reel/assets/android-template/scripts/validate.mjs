#!/usr/bin/env node
/** validate.mjs — must pass before record. Usage: node validate.mjs [flow.json] */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Scaffold layout nests scripts in scripts/ (ROOT = parent);
// the tape experiment keeps them at the root (ROOT = here).
const ROOT = here.endsWith(`${path.sep}scripts`) ? path.join(here, "..") : here;
const flowPath = process.argv[2] || path.join(ROOT, "flows", "create-task.json");
const flow = JSON.parse(fs.readFileSync(flowPath, "utf8"));
const VERBS = new Set(["chapter", "tap", "tapText", "tapCheckboxFor", "type", "key", "swipe", "sleep", "assertVisible", "assertHidden"]);
let err = 0, warn = 0;
const E = (m) => { console.log("ERR ", m); err++; };
const W = (m) => { console.log("WARN", m); warn++; };

if (!flow.package) E("flow.package missing (entry-only launch target)");
for (const [i, st] of flow.steps.entries()) {
  const verbs = Object.keys(st).filter((k) => VERBS.has(k));
  if (verbs.length !== 1) E(`step ${i}: want exactly 1 verb, got [${verbs}] (${JSON.stringify(st).slice(0, 80)})`);
  if (st.tap && Array.isArray(st.tap)) {
    const [x, y] = st.tap;
    if (x < 0 || y < 0 || x > 1080 || y > 2400) W(`step ${i}: tap [${x},${y}] outside 1080x2400 — re-probe on the target device`);
  }
  if (st.type && /[^a-zA-Z0-9 .,!?@_:\-/]/.test(st.type.replace(/\$title/g, ""))) W(`step ${i}: type has chars adb input can't inject — keep to [a-zA-Z0-9 .,!?@_: su/-] or expect failure`);
}
if (!flow.steps.some((s) => s.assertVisible || s.assertHidden)) W("no asserts — the run proves nothing if the UI silently fails");
if (/[—–]/.test(JSON.stringify(flow))) W("em-dashes in flow text — use plain hyphens (device fonts render dashes inconsistently)");
for (const [i, st] of flow.steps.entries())
  if (st.chapter && st.chapter.length > 90) W(`step ${i}: chapter is ${st.chapter.length} chars — keep under ~90 so captions stay compact`);
const taps = flow.steps.filter((s) => s.tap || s.tapText || s.tapCheckboxFor).length;
if (taps > 12) W("many taps — estimated runtime nears the ~90s screenrecord comfort zone, consider splitting the flow");
console.log(`\n${err} errors, ${warn} warnings`);
process.exit(err ? 1 : 0);
