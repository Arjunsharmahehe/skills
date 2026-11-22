#!/usr/bin/env node
// .demo-reel record — run a flow JSON and produce a client-ready demo video.
//
//   node scripts/record.mjs --flow <name> [--from <step-id|n>]
//
// Reads   .demo/flows/<name>.json
// Writes  .demo/out/<name>/{proof.mp4, proof.md, proof.srt}
//   on failure: error-report.md + error.png + partial.mp4 (same dir)
// Session: .demo/out/<name>/auth.json (login runs once; retakes reuse it)
// Position: .demo/out/<name>/checkpoints.json (step id → url)
//
// Validate first: node scripts/validate.mjs --flow <name>
// Test hook: FAIL_AT=<step-id-substring> throws at that step.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import * as H from './lib/human.js';
import { installOverlay } from './lib/overlay.js';

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
  console.error('usage: node scripts/record.mjs --flow <name> [--from <step-id|n>]');
  process.exit(2);
}
const FAIL_AT = process.env.FAIL_AT || '';
const flowPath = join(ROOT, 'flows', `${args.flow}.json`);
if (!existsSync(flowPath)) {
  console.error(`no such flow: ${flowPath}\nrun: node scripts/new-flow.mjs ${args.flow}`);
  process.exit(2);
}
const flow = JSON.parse(readFileSync(flowPath, 'utf8'));
if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
  console.error(`flow "${args.flow}" has no steps — run validate first: node scripts/validate.mjs --flow ${args.flow}`);
  process.exit(2);
}

const { createHash } = await import('node:crypto');
const FLOW_HASH = createHash('sha1').update(JSON.stringify(flow)).digest('hex').slice(0, 12);
const OUT = join(ROOT, 'out', flow.name || args.flow);
mkdirSync(OUT, { recursive: true });
// Retakes never overwrite the deliverable: they write to retakes/<step>/,
// then scripts/stitch.mjs assembles the final proof. State (auth.json,
// checkpoints.json, auth-<step>.json) always lives in OUT/ itself.

for (const f of ['error-report.md', 'error.png', 'partial.mp4']) {
  try { rmSync(join(OUT, f)); } catch {}
}
const AUTH = join(OUT, 'auth.json');
const CKPT = join(OUT, 'checkpoints.json');
const fromArg = args.from || '';

const vars = {};
const interp = (s) =>
  typeof s === 'string' ? s.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;

const chapters = [];
const consoleErrors = [];
const failedRequests = [];
const S = { lastCaption: '' };
let t0 = Date.now();
const mark = (name, t = Date.now() - t0) => {
  chapters.push({ name, t });
  console.log(`  ▶ ${name}`);
};

// ---------- resolve --from with needs-closure rewind ----------
// Draft/in-memory state doesn't survive reload, so resuming rewinds to the
// earliest step needed to rebuild it. Checkpoints hold PRE-step snapshots
// (URL + storage), so replayed steps — even toggles — start from exactly
// the state the full run had.
let startIdx = 0;
let resumeStorage = null;
let resumeUrl = null;
if (fromArg) {
  const byId = flow.steps.findIndex((s) => s.id === fromArg);
  if (byId >= 0) startIdx = byId;
  else if (/^\d+$/.test(fromArg)) startIdx = Math.min(Math.max(parseInt(fromArg, 10) - 1, 0), flow.steps.length - 1);
  else throw new Error(`unknown --from=${fromArg} (ids: ${flow.steps.map((s) => s.id).join(', ')})`);
  if (!existsSync(AUTH)) throw new Error(`--from needs a prior full run — record once without --from first (auth happens once)`);
  const idxOf = (id) => flow.steps.findIndex((s) => s.id === id);
  const closure = new Set([flow.steps[startIdx].id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const st of flow.steps) {
      if (closure.has(st.id)) {
        for (const n of st.needs || []) {
          if (!closure.has(n) && idxOf(n) >= 0) { closure.add(n); grew = true; }
        }
      }
    }
  }
  startIdx = Math.min(...[...closure].map(idxOf));
  if (flow.steps[startIdx].id !== fromArg) {
    console.log(`rewound to "${flow.steps[startIdx].id}" to rebuild state needed by "${fromArg}"`);
  }
  const raw = JSON.parse(readFileSync(CKPT, 'utf8'));
  if (!raw || raw.version !== 3 || !Array.isArray(raw.steps)) {
    throw new Error(`checkpoints are from an older runner — record once without --from to refresh them`);
  }
  if (raw.flowHash !== FLOW_HASH) {
    throw new Error(`flow JSON changed since the full run — record once without --from to refresh checkpoints`);
  }
  Object.assign(vars, raw.latestVars || {});
  const ck = raw.steps.find((c) => c.id === flow.steps[startIdx].id);
  if (!ck) throw new Error(`no checkpoint for "${flow.steps[startIdx].id}" — record once without --from first`);
  const snap = join(OUT, `auth-${flow.steps[startIdx].id}.json`);
  resumeStorage = existsSync(snap) ? snap : AUTH;
  resumeUrl = ck.url;
  console.log(`restoring pre-step state: ${resumeUrl} (+ ${resumeStorage})`);
}

// ---------- browser ----------
const browser = await chromium.launch({ headless: true });
const ctxOpts = {
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
  reducedMotion: 'no-preference',
};
if (resumeStorage && existsSync(resumeStorage)) {
  console.log(`resuming with session ${resumeStorage}`);
  ctxOpts.storageState = resumeStorage;
}
const ctx = await browser.newContext(ctxOpts);
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));

await ctx.addInitScript(installOverlay, { font: flow.font, zoomPercent: flow.zoom ?? 90 });

// ---------- caption / navigation helpers ----------
async function caption(text) {
  text = interp(text);
  S.lastCaption = text;
  await page.evaluate(() => {
    const el = document.getElementById('__reel_cap');
    if (el) el.style.opacity = '0';
  });
  await page.waitForTimeout(200);
  await page.evaluate((t) => {
    const el = document.getElementById('__reel_cap');
    if (el) { el.textContent = t; el.style.opacity = '1'; }
  }, text);
}
// Full page loads recreate the overlay blank+hidden, wiping the caption
// mid-step. Re-assert it after every load so narration survives goto/reload.
async function reassertCaption() {
  if (!S.lastCaption) return;
  await page.evaluate((t) => {
    const el = document.getElementById('__reel_cap');
    if (el) { el.textContent = t; el.style.opacity = '1'; }
  }, S.lastCaption);
}
async function hideCaption() {
  await page.evaluate(() => {
    const el = document.getElementById('__reel_cap');
    if (el) el.style.opacity = '0';
  });
  await page.waitForTimeout(280);
}
async function showTitle() {
  await page.evaluate(({ main, sub }) => {
    const el = document.getElementById('__reel_title');
    if (el) {
      el.innerHTML = sub
        ? `${main}<div style="font-size:13px;font-weight:500;opacity:.75;margin-top:2px;">${sub}</div>`
        : main;
      el.style.opacity = '1';
    }
  }, { main: flow.title || flow.name, sub: flow.subtitle || '' });
}
async function hideTitle() {
  await page.evaluate(() => {
    const el = document.getElementById('__reel_title');
    if (el) el.style.opacity = '0';
  });
  await page.waitForTimeout(380);
}
async function loadUrl(url, label) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(2000);
    }
  }
  const msg = String((lastErr && lastErr.message) || lastErr).split('\n')[0];
  throw new Error(`navigation failed (retry exhausted) ${label}: ${msg}`);
}
async function humanGoto(path, expectSelector) {
  await loadUrl(flow.baseUrl + path, `goto ${path}`);
  // bounded wait for STABLE content: require the selector present in two
  // consecutive polls, so skeleton flashes don't count as loaded
  let stable = 0;
  for (let i = 0; i < 24; i++) {
    const ready = expectSelector
      ? await page.evaluate((sel) => !!document.querySelector(sel), expectSelector)
      : true;
    stable = ready ? stable + 1 : 0;
    if (ready && stable >= 2) break;
    await page.waitForTimeout(500);
  }
  try { await page.evaluate(() => document.fonts.ready); } catch {}
  await page.waitForTimeout(800);
  await reassertCaption();
}
async function assertCond(cond, stepId) {
  const deadline = Date.now() + 12000;
  while (true) {
    const url = page.url();
    const ok =
      (cond.urlIncludes === undefined || url.includes(interp(cond.urlIncludes))) &&
      (cond.urlExcludes === undefined || !url.includes(interp(cond.urlExcludes))) &&
      (cond.textIncludes === undefined ||
        (await page.evaluate(() => document.body.innerText).catch(() => '')).includes(interp(cond.textIncludes))) &&
      (cond.visible === undefined ||
        (await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }, cond.visible).catch(() => false)));
    if (ok) return;
    if (Date.now() > deadline) {
      const keys = Object.entries(cond).map(([k, v]) => `${k}=${v}`).join(', ');
      throw new Error(`assert failed in step "${stepId}": ${keys} (url: ${url})`);
    }
    await page.waitForTimeout(500);
  }
}
// Checkpoints capture PRE-step state: page URL + a storage snapshot.
// Resume restores the rewind target's snapshot, so replayed steps (even
// toggles) start from exactly the state the full run had — never from
// whatever a failed run left behind.
async function checkpoint(id) {
  let ckpt = { version: 3, flowHash: FLOW_HASH, latestVars: { ...vars }, steps: [] };
  try {
    const raw = JSON.parse(readFileSync(CKPT, 'utf8'));
    if (raw && raw.version === 3 && raw.flowHash === FLOW_HASH) ckpt = raw;
  } catch {}
  ckpt.latestVars = { ...vars };
  ckpt.steps = ckpt.steps.filter((c) => c.id !== id);
  ckpt.steps.push({ id, url: page.url(), at: new Date().toISOString() });
  writeFileSync(CKPT, JSON.stringify(ckpt, null, 1));
  try { await ctx.storageState({ path: join(OUT, `auth-${id}.json`) }); } catch {}
  try { await ctx.storageState({ path: AUTH }); } catch {}
}

// ---------- action executor ----------
async function runAction(a, stepId) {
  switch (a.do) {
    case 'goto':
      await humanGoto(a.path, a.expect);
      break;
    case 'reload':
      try {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch {
        // navigation eventing can stall (long-lived connections, aborted
        // beacons) while the document itself is fine — force + settle
        await page.evaluate(() => location.reload()).catch(() => {});
        await page.waitForTimeout(2000);
      }
      await page.waitForTimeout(1500);
      await reassertCaption();
      break;
    case 'click':
      await H.humanClick(page, a.selector);
      break;
    case 'clickText':
      await H.humanClickText(page, interp(a.text), { exact: !!a.exact });
      break;
    case 'pick':
      await H.humanPickOption(page, a.trigger, interp(a.option));
      await page.waitForTimeout(400);
      break;
    case 'select':
      await H.humanSelect(page, a.selector, { value: a.value, label: a.label, index: a.index });
      await page.waitForTimeout(300);
      break;
    case 'type':
      await H.humanType(page, a.selector, interp(a.text));
      break;
    case 'fill':
      await H.humanFill(page, a.selector, interp(a.text));
      break;
    case 'scrollTo':
      await H.scrollToElement(page, a.selector);
      break;
    case 'scroll':
      await H.scrollTo(page, a.to ?? 'top');
      break;
    case 'wait':
      await page.waitForTimeout(Number(a.ms) || 500);
      break;
    case 'caption':
      await caption(a.text);
      break;
    case 'assert':
      await assertCond(a, stepId);
      break;
    case 'extract': {
      const m = (a.match || '').toString();
      const re = new RegExp(m);
      let src = '';
      if (a.from === 'url') src = page.url();
      else if (a.from === 'text') src = await page.evaluate((sel) => document.querySelector(sel)?.innerText || '', a.selector || 'body');
      else throw new Error(`extract: unknown from "${a.from}" in step "${stepId}"`);
      const hit = src.match(re);
      if (!hit) throw new Error(`extract failed in step "${stepId}": /${m}/ not found`);
      vars[a.as] = hit[1] || hit[0];
      break;
    }
    default:
      throw new Error(`unknown action "${a.do}" in step "${stepId}" — run validate: node scripts/validate.mjs --flow ${args.flow}`);
  }
}

// ---------- run ----------
t0 = Date.now();
let failedStep = null;
let rawVideoPath = null;
// Artifact dir is fixed before anything can throw: retakes never clobber
// the deliverable, and the catch block can always write its report.
const ART = fromArg ? join(OUT, 'retakes', flow.steps[startIdx].id) : OUT;
mkdirSync(ART, { recursive: true });
for (const f of ['error-report.md', 'error.png', 'partial.mp4', 'proof.mp4', 'proof.md', 'proof.srt']) {
  try { if (ART !== OUT) rmSync(join(ART, f)); } catch {}
}
if (fromArg) {
  writeFileSync(join(ART, 'retake.json'), JSON.stringify({
    flow: flow.name || args.flow, requestedFrom: fromArg,
    rewoundTo: flow.steps[startIdx].id, at: new Date().toISOString(),
  }, null, 1));
}
const shortErr = (err) => {
  const lines = String((err && err.message) || err).split('\n').filter(Boolean);
  if (lines.length <= 4) return lines.join('\n');
  return [lines[0], '…', ...lines.slice(-3)].join('\n');
};
try {
  console.log(`demo-reel record: ${flow.name}${fromArg ? ` (resume from "${flow.steps[startIdx].id}")` : ''}`);
  if (startIdx === 0 && (flow.title || flow.subtitle)) {
    // Opening card first: on a blank page when the overlay is ready,
    // so slow entry loads never bury it mid-render (guarded — about:blank
    // may not run init scripts, in which case we show it after load).
    // Only play the pre-navigation beat when the overlay already exists
    // (init scripts don't run on the initial blank page in most drivers —
    // checking first avoids opening every video with dead air).
    let titled = false;
    try {
      titled = await page.evaluate(() => !!document.getElementById('__reel_layer'));
      if (titled) {
        await showTitle();
        await page.waitForTimeout(1800);
        await hideTitle();
      }
    } catch { titled = false; }
    const entry = flow.steps[0]?.actions?.find((a) => a.do === 'goto');
    await humanGoto(entry?.path || '/', entry?.expect || 'body');
    if (!titled) {
      await showTitle();
      await page.waitForTimeout(1800);
      await hideTitle();
    }
  }

  if (resumeUrl) {
    await loadUrl(resumeUrl, 'resume position');
    await page.waitForTimeout(1500);
  }
  for (let i = startIdx; i < flow.steps.length; i++) {
    const st = flow.steps[i];
    failedStep = st;
    if (FAIL_AT && st.id.includes(FAIL_AT)) throw new Error(`[simulated] failure injected at step "${st.id}" (FAIL_AT=${FAIL_AT})`);
    await checkpoint(st.id); // pre-step snapshot: URL + storage
    const beatStart = Date.now() - t0; // chapters mark beat *starts* (when the caption appears)
    if (st.caption) await caption(st.caption);
    for (const a of st.actions || []) await runAction(a, st.id);
    mark(interp(st.chapter || st.caption || st.id), beatStart);
  }
  await hideCaption();
  await page.waitForTimeout(400);

  rawVideoPath = await page.video().path();
  await ctx.close();
  await browser.close();

  const out = join(ART, 'proof.mp4');
  execSync(
    `ffmpeg -y -i "${rawVideoPath}" -vf scale=1280:720 -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart "${out}"`,
    { stdio: 'pipe' }
  );
  const sizeMB = statSync(out).size / 1024 / 1024;
  try { rmSync(rawVideoPath); } catch {} // raw is superseded by proof.mp4
  const srt = chapters.map((c, i) => {
    const f = (ms) => `00:00:${String(Math.floor(ms / 1000)).padStart(2, '0')},000`;
    return `${i + 1}\n${f(c.t)} --> ${f(chapters[i + 1]?.t ?? c.t + 2500)}\n${c.name}\n`;
  }).join('\n');
  writeFileSync(join(ART, 'proof.srt'), srt);
  const varLines = Object.entries(vars).map(([k, v]) => `- ${k}: ${v}`).join('\n');
  writeFileSync(join(ART, 'proof.md'),
    `# proof — ${flow.title || flow.name}\n\n- task: ${interp(flow.task || flow.title || flow.name)}\n- url: ${flow.baseUrl}\n${varLines ? varLines + '\n' : ''}- video: proof.mp4 (${sizeMB.toFixed(2)} MB)\n- chapters:\n${chapters.map((c) => `  - ${(c.t / 1000).toFixed(1)}s ${c.name}`).join('\n')}\n- console errors: ${consoleErrors.length ? consoleErrors.join(' | ') : 'none'}\n- failed requests: ${failedRequests.length ? failedRequests.join(' | ') : 'none'}\n`);
  console.log(`done: ${out} (${sizeMB.toFixed(2)} MB) — wrote proof.md + proof.srt`);
} catch (err) {
  console.error(`FAILED at step "${failedStep?.id}": ${shortErr(err)}`);
  const shot = join(ART, 'error.png');
  let ctxAlive = true;
  try { await page.evaluate('1'); } catch { ctxAlive = false; }
  if (ctxAlive) {
    try { await page.screenshot({ path: shot, fullPage: true }); } catch {}
  }
  let rawVideo = rawVideoPath;
  if (!rawVideo && ctxAlive) {
    try { rawVideo = await page.video().path(); } catch {}
  }
  if (ctxAlive) { try { await ctx.close(); } catch {} }
  try { await browser.close(); } catch {}
  let partial = null;
  if (rawVideo && existsSync(rawVideo)) {
    try {
      if (statSync(rawVideo).size > 0) {
        partial = join(ART, 'partial.mp4');
        execSync(`ffmpeg -y -i "${rawVideo}" -vf scale=1280:720 -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p "${partial}"`, { stdio: 'pipe' });
        try { rmSync(rawVideo); } catch {}
      }
    } catch { partial = null; }
  }
  const stepIdx = flow.steps.indexOf(failedStep);
  writeFileSync(join(ART, 'error-report.md'),
    `# error report — ${flow.title || flow.name}\n\n- failed step: ${failedStep?.id} (step ${stepIdx + 1}/${flow.steps.length})\n- error: ${shortErr(err)}\n- last caption: ${S.lastCaption || '(none)'}\n- url at failure: ${ctxAlive ? page.url() : '(browser already closed — failure was in export)'}\n- completed chapters:\n${chapters.map((c) => `  - ${(c.t / 1000).toFixed(1)}s ${c.name}`).join('\n') || '  (none)'}\n- screenshot: ${existsSync(shot) ? 'error.png' : ctxAlive ? '(capture failed)' : '(n/a — failed after recording finished)'}\n- partial video: ${partial ? 'partial.mp4' : '(no usable footage)'}\n- console errors: ${consoleErrors.length ? consoleErrors.join(' | ') : 'none'}\n- failed requests: ${failedRequests.length ? failedRequests.join(' | ') : 'none'}\n\n## how to fix + rerecord\n1. Fix the issue above (selector, validation, or app state).\n2. Rerecord from the failed chapter — auth is already saved, no re-login:\n   \`node scripts/record.mjs --flow ${args.flow} --from=${failedStep?.id}\`\n3. Or restart clean: \`node scripts/record.mjs --flow ${args.flow}\`\n`);
  console.log(`wrote error-report.md${existsSync(shot) ? ' + error.png' : ''}${partial ? ' + partial.mp4' : ''}`);
  process.exitCode = 1;
}
