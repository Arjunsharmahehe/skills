#!/usr/bin/env node
/** probe.mjs — dump the on-device UI hierarchy and query it.
 *  Usage:
 *    node probe.mjs dump [--out ui.xml]
 *    node probe.mjs find --text "Exact text" [--out ui.xml]
 *    node probe.mjs find --contains "substring"
 *    node probe.mjs check --checkbox-for "Row title"
 *  This is the mobile equivalent of demo-reel's "probe the live app first":
 *  never write a flow with an unprobed selector.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { dumpXml } from "./lib/adb.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
// Scaffold layout nests scripts in scripts/ (ROOT = parent);
// the tape experiment keeps them at the root (ROOT = here).
const ROOT = here.endsWith(`${path.sep}scripts`) ? path.join(here, "..") : here;
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : null;
};
const outDir = path.join(ROOT, "out");
fs.mkdirSync(outDir, { recursive: true });
const xml = opt("--out") || path.join(outDir, "_probe.xml");

await dumpXml(xml);
console.log("dumped", xml);

if (cmd === "dump") {
  const rows = execFileSync("python3",
    ["-c", `
import xml.etree.ElementTree as ET, sys
for n in ET.parse(${JSON.stringify(xml)}).getroot().iter("node"):
    t=(n.get("text") or "")[:50]; d=(n.get("content-desc") or "")[:30]; b=n.get("bounds")
    if t.strip() or d.strip(): print(f"{t!r} desc={d!r} {b}")
`], { encoding: "utf8" });
  console.log(rows);
} else if (cmd === "find" || cmd === "check") {
  const mode = opt("--text") ? "--text" : opt("--contains") ? "--has-text"
    : opt("--checkbox-for") ? "--checkbox-for" : null;
  const q = opt("--text") || opt("--contains") || opt("--checkbox-for");
  if (!mode) { console.error("give --text | --contains | --checkbox-for"); process.exit(2); }
  try {
    const out = execFileSync("python3",
      [path.join(here, "lib", "find.py"), xml, mode, q], { encoding: "utf8" }).trim();
    console.log(out);
  } catch { console.error("FAIL: not found — re-probe after the UI settles"); process.exit(1); }
}
