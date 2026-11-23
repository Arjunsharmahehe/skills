import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFile = promisify(_execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
// Scaffold layout nests scripts in scripts/ (ROOT = parent);
// the tape experiment keeps them at the root (ROOT = here).
const ROOT = here.endsWith(`${path.sep}scripts`) ? path.join(here, "..") : here;
const outDir = path.join(ROOT, "out");
const TITLE_S = 2.0; // title card seconds prepended

const events = JSON.parse(fs.readFileSync(path.join(outDir, "events.json"), "utf8"));
const chapters = JSON.parse(fs.readFileSync(path.join(outDir, "chapters.json"), "utf8"));
const flow = JSON.parse(fs.readFileSync(path.join(outDir, "flow.json"), "utf8"));
const meta = flow.meta || {};
const cardTitle = meta.cardTitle || "Android demo";
const cardSubtitle = meta.cardSubtitle || flow.package || "";
const proofTitle = meta.proofTitle || flow.package || "android demo";
const eyebrow = meta.eyebrow ||
  `${(flow.package || "app").split(".").pop().toUpperCase()} \u00b7 ANDROID DEMO`;
const dur = events.duration + TITLE_S;

function fmtASS(s) {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${sec}`;
}
function fmtSRT(s) {
  s = Math.max(0, s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60), ms = Math.floor((s % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// captions: each chapter shows until the next one (last holds 2.5s)
const FONT = "/usr/share/fonts/TTF/DejaVuSans.ttf";
fs.mkdirSync(path.join(outDir, "caps"), { recursive: true });
let srt = "";
const draws = [];
chapters.forEach((c, i) => {
  const start = c.t + TITLE_S;
  const end = (i + 1 < chapters.length ? chapters[i + 1].t : c.t + 2.5) + TITLE_S;
  const txtPath = path.join(outDir, "caps", `cap${i}.txt`);
  fs.writeFileSync(txtPath, c.caption);
  srt += `${i + 1}\n${fmtSRT(start)} --> ${fmtSRT(end)}\n${c.caption}\n\n`;
});
fs.writeFileSync(path.join(outDir, "proof.srt"), srt);
await execFile("python3", [
  path.join(here, "lib", "caption.py"),
  path.join(outDir, "caps"), "32", "460",
]);
chapters.forEach((c, i) => {
  // One drawtext per line, each centering on its own width: a two-line
  // caption can't drift or clip the way a multiline block can.
  const start = c.t + TITLE_S;
  const end = (i + 1 < chapters.length ? chapters[i + 1].t : c.t + 2.5) + TITLE_S;
  const lines = fs.readFileSync(path.join(outDir, "caps", `cap${i}.txt`), "utf8").split("\n");
  const y0 = 1320 - (lines.length - 1) * 56; // stack upward, clear of nav
  lines.forEach((text, li) => {
    const linePath = path.join(outDir, "caps", `cap${i}_l${li}.txt`);
    fs.writeFileSync(linePath, text);
    draws.push(
      `drawtext=fontfile=${FONT}:textfile=${linePath}`
      + `:fontsize=32:fontcolor=white`
      + `:box=1:boxcolor=black@0.5:boxborderw=16:x=(w-text_w)/2:y=${y0 + li * 48}`
      + `:enable='between(t,${start.toFixed(2)},${end.toFixed(2)})'`,
    );
  });
});

await execFile("python3", [
  path.join(here, "lib", "finger_overlay.py"),
  path.join(outDir, "events.json"),
  path.join(outDir, "finger.mov"),
]);
await execFile("python3", [
  path.join(here, "lib", "titlecard.py"),
  path.join(outDir, "title.png"),
  cardTitle.replace(/\s+/g, " ").trim(),
]);

const fc = "[0:v]scale=720:1600,fps=30,format=yuv420p[ttl];"
  + "[1:v]scale=720:1600,fps=30,format=yuv420p[base];"
  + "[ttl][base]concat=n=2:v=1:a=0[joined];"
  + `[2:v]scale=720:1600,setpts=PTS+${TITLE_S}/TB[fg];`
  + "[joined][fg]overlay=0:0:eof_action=pass,"
  + draws.join(",") + ",format=yuv420p[out]";

await execFile("ffmpeg", [
  "-y", "-v", "error",
  "-loop", "1", "-framerate", "30", "-t", String(TITLE_S), "-i", path.join(outDir, "title.png"),
  "-i", path.join(outDir, "raw.mp4"),
  "-i", path.join(outDir, "finger.mov"),
  "-filter_complex", fc,
  "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "23",
  "-movflags", "+faststart", "-t", String(dur.toFixed(2)),
  path.join(outDir, "proof.mp4"),
], { timeout: 300_000 });

const st = fs.statSync(path.join(outDir, "proof.mp4"));
const md = `# proof — ${proofTitle}\n\n`
  + `video: proof.mp4 (${(st.size / 1024 / 1024).toFixed(1)} MB, ${(dur).toFixed(0)}s, 720x1600)\n`
  + `device: emulator-5554 (sdk_gphone16k_x86_64) · package: com.example.campusplanner\n\n## chapters\n`
  + chapters.map((c, i) => `${i + 1}. [${fmtSRT(c.t + TITLE_S).slice(3)}] ${c.caption}`).join("\n") + "\n";
fs.writeFileSync(path.join(outDir, "proof.md"), md);
console.log("proof.mp4", (st.size / 1024).toFixed(0) + "KB", dur.toFixed(1) + "s");
console.log(md);
