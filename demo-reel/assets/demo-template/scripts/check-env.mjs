#!/usr/bin/env node
// .demo-reel check-env — verify everything needed to record.
//
//   node scripts/check-env.mjs
import { execSync } from 'child_process';

let failed = false;
const ok = (label, detail = '') => console.log(`✓ ${label}${detail ? ` — ${detail}` : ''}`);
const bad = (label, fix) => { failed = true; console.log(`✗ ${label}\n  fix: ${fix}`); };

// node
{
  const v = process.versions.node.split('.')[0];
  if (Number(v) >= 18) ok(`node ${process.versions.node}`);
  else bad(`node ${process.versions.node}`, 'install node 18+');
}
// ffmpeg
try {
  const v = execSync('ffmpeg -version', { stdio: 'pipe' }).toString().split('\n')[0];
  ok('ffmpeg', v.replace('ffmpeg version ', '').slice(0, 40));
} catch {
  bad('ffmpeg not found', 'install ffmpeg (apt/brew/choco) — required to compress proof.mp4');
}
// playwright + chromium
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  const ver = browser.version();
  await browser.close();
  ok('playwright + chromium', `chromium ${ver}`);
} catch (e) {
  bad('playwright/chromium launch failed', 'run: npm install && npx playwright install chromium');
}
process.exit(failed ? 1 : 0);
