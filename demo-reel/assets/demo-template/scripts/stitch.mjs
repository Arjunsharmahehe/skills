#!/usr/bin/env node
// .demo-reel stitch — assemble the final deliverable after a chapter retake.
//
// Retakes write to out/<flow>/retakes/<step>/ (never over the deliverable).
// Stitch cuts the original proof at the retaken chapter and concatenates
// the fragment, then rebuilds proof.md/.srt. Originals are kept as
// proof.prev.*.
//
//   node scripts/stitch.mjs --flow <name> [--retake <step-id>]
//
// Without --retake, the latest retake (by retake.json timestamp) is used.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length; i++) {
  const m = argv[i].match(/^--([^=]+)(=(.*))?$/);
  if (!m) continue;
  if (m[3] !== undefined) args[m[1]] = m[3];
  else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[m[1]] = argv[++i];
  else args[m[1]] = true;
}
if (!args.flow) {
  console.error('usage: node scripts/stitch.mjs --flow <name> [--retake <step-id>]');
  process.exit(2);
}

const flow = JSON.parse(readFileSync(join(ROOT, 'flows', `${args.flow}.json`), 'utf8'));
const OUT = join(ROOT, 'out', flow.name || args.flow);
const origMp4 = join(OUT, 'proof.mp4');
const origSrt = join(OUT, 'proof.srt');
if (!existsSync(origMp4) || !existsSync(origSrt)) {
  console.error(`no complete proof in ${OUT} — record once without --from first`);
  process.exit(1);
}

// pick the retake
const rdir = join(OUT, 'retakes');
let rname = args.retake;
if (!rname) {
  const cands = existsSync(rdir) ? readdirSync(rdir).filter((d) => {
    try { JSON.parse(readFileSync(join(rdir, d, 'retake.json'), 'utf8')); return true; }
    catch { return false; }
  }) : [];
  if (!cands.length) { console.error(`no retakes found in ${rdir}`); process.exit(1); }
  cands.sort((a, b) => JSON.parse(readFileSync(join(rdir, a, 'retake.json'), 'utf8')).at.localeCompare(
    JSON.parse(readFileSync(join(rdir, b, 'retake.json'), 'utf8')).at));
  rname = cands[cands.length - 1];
}
const R = join(rdir, rname);
const meta = JSON.parse(readFileSync(join(R, 'retake.json'), 'utf8'));
for (const f of ['proof.mp4', 'proof.srt']) {
  if (!existsSync(join(R, f))) { console.error(`retake ${rname} is incomplete (missing ${f}) — re-run the retake first`); process.exit(1); }
}

// cut point = start of the retake's first chapter in the ORIGINAL srt.
// Rewind replays from <rewoundTo>, so the original's chapter for that step
// index is where the fragment takes over. Chapter order == step order.
const k = flow.steps.findIndex((s) => s.id === meta.rewoundTo);
if (k < 0) { console.error(`rewound step "${meta.rewoundTo}" not in current flow — flow changed since retake; re-record`); process.exit(1); }

const parseSrt = (text) => text.trim().split(/\n\s*\n/).map((b) => {
  const [n, tm, ...rest] = b.split('\n');
  const [a, z] = tm.split(' --> ');
  const t = (s) => { const m = s.match(/(\d+):(\d+):([\d.]+)/); return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]); };
  return { n: +n, a: t(a), z: t(z), text: rest.join('\n') };
});
const fmt = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(3);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(6, '0').replace('.', ',')}`;
};
const oldEntries = parseSrt(readFileSync(origSrt, 'utf8'));
const fragEntries = parseSrt(readFileSync(join(R, 'proof.srt'), 'utf8'));
if (k >= oldEntries.length) { console.error(`original srt has ${oldEntries.length} chapters but cut needs #${k + 1} — proof and flow are out of sync; re-record`); process.exit(1); }
const cut = oldEntries[k].a;
console.log(`cutting original at chapter ${k + 1} ("${oldEntries[k].text}", ${cut.toFixed(1)}s), appending retake "${rname}"`);

const tmp = join(OUT, '.tmp-stitch');
mkdirSync(tmp, { recursive: true });
try {
  if (cut > 0.5) {
    execSync(`ffmpeg -y -v error -i "${origMp4}" -ss 0 -to ${cut} -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p "${join(tmp, 'head.mp4')}"`, { stdio: 'pipe' });
  }
  const inputs = cut > 0.5
    ? `-i "${join(tmp, 'head.mp4')}" -i "${join(R, 'proof.mp4')}"`
    : `-i "${join(R, 'proof.mp4')}"`;
  const filter = cut > 0.5
    ? `-filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[outv]" -map "[outv]"`
    : '';
  execSync(`ffmpeg -y -v error ${inputs} ${filter} -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart "${join(tmp, 'proof.mp4')}"`, { stdio: 'pipe' });

  // merged srt: original head chapters + fragment chapters offset by cut
  const merged = [
    ...oldEntries.slice(0, k),
    ...fragEntries.map((e, i) => ({ n: 0, a: e.a + cut, z: e.z + cut, text: e.text })),
  ].map((e, i) => `${i + 1}\n${fmt(e.a)} --> ${fmt(e.z)}\n${e.text}\n`).join('\n');
  writeFileSync(join(tmp, 'proof.srt'), merged);

  // merge proof.md: keep original header, mark stitched chapters, append note
  let md = readFileSync(join(OUT, 'proof.md'), 'utf8');
  md += `\n- stitched: retake "${rname}" (from "${meta.requestedFrom}", rewound to "${meta.rewoundTo}") cut original at ${cut.toFixed(1)}s\n`;
  writeFileSync(join(tmp, 'proof.md'), md);

  for (const f of ['proof.mp4', 'proof.md', 'proof.srt']) {
    if (existsSync(join(OUT, f))) copyFileSync(join(OUT, f), join(OUT, f.replace('proof', 'proof.prev')));
    copyFileSync(join(tmp, f), join(OUT, f));
  }
  const sizeMB = statSync(join(OUT, 'proof.mp4')).size / 1024 / 1024;
  console.log(`done: ${join(OUT, 'proof.mp4')} (${sizeMB.toFixed(2)} MB, ${merged.split('\n').filter((l) => /-->/.test(l)).length} chapters) — originals kept as proof.prev.*`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
