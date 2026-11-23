#!/usr/bin/env node
/** check-env.mjs — fail fast when the Android toolchain is missing. */
import { execFileSync } from "node:child_process";

let fail = 0;
const need = (cmd, args, hint) => {
  try {
    execFileSync(cmd, args, { stdio: "ignore" });
    console.log(`ok   ${cmd}`);
  } catch { console.log(`FAIL ${cmd} — ${hint}`); fail = 1; }
};
need("node", ["--version"], "install node 18+");
need("adb", ["version"], "add ~/Android/Sdk/platform-tools to PATH");
need("ffmpeg", ["-version"], "install ffmpeg");
need("python3", ["-c", "import PIL"], "pip install pillow");

try {
  const out = execFileSync("adb", ["devices"], { encoding: "utf8" });
  const devs = out.split("\n").filter((l) => l.endsWith("\tdevice"));
  console.log(devs.length ? `ok   device: ${devs[0].split("\t")[0]}` : "WARN no device attached (start the emulator)");
} catch { console.log("FAIL adb devices"); fail = 1; }
process.exit(fail);
