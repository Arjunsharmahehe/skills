import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(_execFile);
export const DEVICE = process.env.ANDROID_SERIAL || "emulator-5554";

export async function adb(...args) {
  const { stdout, stderr } = await execFile(
    "adb",
    ["-s", DEVICE, ...args],
    { timeout: 30_000 },
  );
  return (stdout + stderr).trim();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Tap helper that also appends a timestamped entry to the event log. */
export function makeLogger() {
  const t0 = Date.now();
  const events = [];
  return {
    t0,
    events,
    /** log an event at current time (seconds since t0) */
    mark(type, x, y, extra = {}) {
      const t = (Date.now() - t0) / 1000;
      events.push({ t: +t.toFixed(2), type, x, y, ...extra });
      return t;
    },
  };
}

export async function tap(log, x, y, label = "") {
  const t = log.mark("tap", x, y, label ? { label } : {});
  await adb("shell", "input", "tap", String(x), String(y));
  return t;
}

export async function swipe(x1, y1, x2, y2, ms = 500) {
  await adb(
    "shell",
    "input",
    "swipe",
    String(x1),
    String(y1),
    String(x2),
    String(y2),
    String(ms),
  );
}

export async function keyevent(code) {
  await adb("shell", "input", "keyevent", String(code));
}

/** Type ASCII text via adb input (spaces must be %s). Clears field first with N DELs. */
export async function typeText(text, { clearDels = 30 } = {}) {
  if (clearDels > 0) {
    await adb(
      "shell",
      `for i in $(seq 1 ${clearDels}); do input keyevent 67; done`,
    );
  }
  const escaped = text.replace(/ /g, "%s").replace(/'/g, "");
  await adb("shell", "input", "text", escaped);
}

export async function launch(packageName) {
  await adb(
    "shell",
    "monkey",
    "-p",
    packageName,
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  );
}

export async function screencap(outPath) {
  const { execFileSync } = await import("node:child_process");
  const fs = await import("node:fs");
  const data = execFileSync("adb", ["-s", DEVICE, "exec-out", "screencap", "-p"]);
  fs.writeFileSync(outPath, data);
  return outPath;
}

export async function dumpXml(outPath) {
  await adb("shell", "uiautomator", "dump", "/sdcard/ui.xml");
  await execFile("adb", ["-s", DEVICE, "pull", "/sdcard/ui.xml", outPath]);
  const fs = await import("node:fs");
  return fs.readFileSync(outPath, "utf8");
}
