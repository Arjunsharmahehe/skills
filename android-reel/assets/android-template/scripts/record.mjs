import { execFile as _execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEVICE,
  adb,
  sleep,
  makeLogger,
  tap,
  swipe,
  keyevent,
  typeText,
} from "./lib/adb.mjs";
import { dumpXml } from "./lib/adb.mjs";
import { execFileSync } from "node:child_process";

const execFile = promisify(_execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
// Scaffold layout nests scripts in scripts/ (ROOT = parent);
// the tape experiment keeps them at the root (ROOT = here).
const ROOT = here.endsWith(`${path.sep}scripts`) ? path.join(here, "..") : here;
const DRY = process.argv.includes("--dry");
const FLOW_PATH = process.argv.find((a) => a.endsWith(".json")) ||
  path.join(ROOT, "flows", "create-task.json");

const outDir = path.join(ROOT, "out");
fs.mkdirSync(outDir, { recursive: true });

const flow = JSON.parse(fs.readFileSync(FLOW_PATH, "utf8"));
const vars = { title: process.env.TASK_TITLE || flow.title || "Demo task" };
const sub = (s) => typeof s === "string" ? s.replace(/\$title/g, vars.title) : s;

const log = makeLogger();
const chapters = [];
function chapter(caption) {
  const t = (Date.now() - log.t0) / 1000;
  chapters.push({ t: +t.toFixed(2), caption });
  console.log(`[${t.toFixed(1)}s] ${caption}`);
}

const qxml = path.join(outDir, "_q.xml");
async function dump() { await dumpXml(qxml); }
function find(mode, text) {
  const out = execFileSync("python3", [path.join(here, "lib", "find.py"), qxml, mode, sub(text)],
    { encoding: "utf8" }).trim();
  if (out.startsWith("FAIL") || out === "") throw new Error(`probe ${mode} ${text}: not found`);
  return out;
}
async function hasText(text) {
  await dump();
  const out = execFileSync("python3", [path.join(here, "lib", "find.py"), qxml, "--has-text", sub(text)],
    { encoding: "utf8" }).trim();
  return out === "YES";
}

let recorder = null;
let videoZero = 0;
async function startRecording() {
  if (DRY) return 0;
  await adb("shell", "rm", "-f", "/sdcard/cp-demo.mp4");
  const spawnT = Date.now();
  videoZero = (spawnT - log.t0) / 1000 + 0.4;
  recorder = spawn("adb",
    ["-s", DEVICE, "shell", "screenrecord", "--size", "1080x2400",
     "--bit-rate", "6M", "--time-limit", "90", "/sdcard/cp-demo.mp4"],
    { stdio: "ignore" });
  await sleep(1500);
  return videoZero;
}
async function stopRecording() {
  if (DRY) return;
  await adb("shell", "pkill", "-2", "screenrecord").catch(() => {});
  await sleep(1200);
  await execFile("adb", ["-s", DEVICE, "pull", "/sdcard/cp-demo.mp4", path.join(outDir, "raw.mp4")]);
}

async function runStep(st) {
  if (st.chapter) { chapter(sub(st.chapter)); return; }
  if (st.tap) {
    const [x, y] = st.tap;
    await tap(log, x, y, st.label || "");
  } else if (st.tapText) {
    await dump();
    const [x, y] = find("--text", st.tapText).split(" ").map(Number);
    await tap(log, x, y, st.label || st.tapText);
  } else if (st.tapCheckboxFor) {
    const spec = typeof st.tapCheckboxFor === "string" ? { text: st.tapCheckboxFor } : st.tapCheckboxFor;
    let tapped = false;
    for (let i = 0; i <= (spec.reveal ?? 0); i++) {
      await dump();
      try {
        const [x, y] = find("--checkbox-for", spec.text).split(" ").map(Number);
        await tap(log, x, y, "done:" + sub(spec.text));
        tapped = true; break;
      } catch { await swipe(540, 1700, 540, 700, 400); await sleep(1200); }
    }
    if (!tapped) throw new Error(`tapCheckboxFor failed: ${spec.text}`);
  } else if (st.type) {
    await typeText(sub(st.type), { clearDels: st.clearDels ?? 25 });
  } else if (st.key) {
    await keyevent(st.key);
  } else if (st.swipe) {
    const [x1, y1, x2, y2, ms] = st.swipe;
    await swipe(x1, y1, x2, y2, ms ?? 500);
  } else if (st.assertVisible) {
    const spec = typeof st.assertVisible === "string" ? { text: st.assertVisible } : st.assertVisible;
    let ok = false;
    for (let i = 0; i <= (spec.reveal ?? 0); i++) {
      if (await hasText(spec.text)) { ok = true; break; }
      await swipe(540, 1700, 540, 700, 400); // reveal more rows
      await sleep(1200);
    }
    if (!ok) throw new Error(`assertVisible failed: ${spec.text}`);
    console.log(`  assert visible OK: ${sub(spec.text)}`);
    return;
  } else if (st.assertHidden) {
    if (await hasText(st.assertHidden)) throw new Error(`assertHidden failed: ${st.assertHidden}`);
    console.log(`  assert hidden OK: ${sub(st.assertHidden)}`);
    return;
  } else if (st.sleep) {
    await sleep(st.sleep); return;
  } else throw new Error(`unknown step: ${JSON.stringify(st)}`);
  await sleep(st.settle ?? 800);
}

await startRecording();
try {
  await adb("shell", "am", "force-stop", flow.package);
  await sleep(800);
  const { stdout } = await execFile("adb", ["-s", DEVICE, "shell", "monkey",
    "-p", flow.package, "-c", "android.intent.category.LAUNCHER", "1"]);
  if (!/Events injected: 1/.test(stdout)) throw new Error("launch failed");
  await sleep(2000);
  for (const st of flow.steps) await runStep(st);
} finally {
  await stopRecording();
}

const events = log.events.map((e) => ({ ...e, t: +(e.t - videoZero).toFixed(2) }))
  .filter((e) => e.t >= -0.5)
  .map((e) => ({ ...e, t: Math.max(0, e.t) }));
if (events.length) events.unshift({ t: 0, type: "park", x: events[0].x, y: events[0].y });
const lastTap = events.filter((e) => e.type === "tap").pop();
const duration = lastTap.t + 2.5;
fs.writeFileSync(path.join(outDir, "events.json"),
  JSON.stringify({ width: 1080, height: 2400, duration: +duration.toFixed(2), taps: events }, null, 2));
fs.writeFileSync(path.join(outDir, "chapters.json"), JSON.stringify(
  chapters.map((c) => ({ ...c, t: +(c.t - videoZero).toFixed(2) })), null, 2));
fs.writeFileSync(path.join(outDir, "flow.json"), JSON.stringify(flow, null, 2));
console.log("events:", events.length, "duration:", duration.toFixed(1) + "s");
