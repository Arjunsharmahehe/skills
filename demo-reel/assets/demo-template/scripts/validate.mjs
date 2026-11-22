#!/usr/bin/env node
// .demo-reel validate — static checks for flow JSON. No browser needed.
// Gate: record.mjs runs are only meaningful after this passes.
//
//   node scripts/validate.mjs --flow <name> | --all
import { readFileSync, readdirSync, existsSync } from 'fs';
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

const ACTIONS = {
  goto: ['path'],
  reload: [],
  click: ['selector'],
  clickText: ['text'],
  pick: ['trigger', 'option'],
  type: ['selector', 'text'],
  fill: ['selector', 'text'],
  scrollTo: ['selector'],
  scroll: ['to'],
  select: ['selector'],
  wait: ['ms'],
  caption: ['text'],
  assert: [], // at least one of urlIncludes|urlExcludes|textIncludes|visible
  extract: ['as', 'from', 'match'],
};

function validateFlow(name) {
  const errors = [];
  const warnings = [];
  const path = join(ROOT, 'flows', `${name}.json`);
  if (!existsSync(path)) return { errors: [`flows/${name}.json not found — run: node scripts/new-flow.mjs ${name}`], warnings };
  let flow;
  try {
    flow = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { errors: [`invalid JSON: ${e.message}`], warnings };
  }
  const at = (i, id) => `step ${i + 1}${id ? ` ("${id}")` : ''}`;
  for (const f of ['name', 'title', 'baseUrl', 'steps']) {
    if (flow[f] === undefined) errors.push(`missing top-level field "${f}"`);
  }
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    errors.push('steps must be a non-empty array');
    return { errors, warnings };
  }
  if (flow.name && flow.name !== name) warnings.push(`file is ${name}.json but flow.name is "${flow.name}" (outputs go to out/${flow.name}/)`);

  const ids = flow.steps.map((s) => s?.id).filter(Boolean);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  for (const d of [...new Set(dupes)]) errors.push(`duplicate step id "${d}"`);
  flow.steps.forEach((s, i) => {
    if (!s || typeof s !== 'object') { errors.push(`${at(i)}: must be an object`); return; }
    if (!s.id) errors.push(`${at(i)}: missing "id"`);
    if (!s.caption && !s.chapter) errors.push(`${at(i, s.id)}: needs "caption" (shown in video) or "chapter"`);
    if (s.caption && s.caption.length > 140) warnings.push(`${at(i, s.id)}: caption is ${s.caption.length} chars — keep ≤140 so it fits one line`);
    for (const n of s.needs || []) {
      if (n === s.id) errors.push(`${at(i, s.id)}: needs itself`);
      else if (!ids.includes(n)) errors.push(`${at(i, s.id)}: needs unknown step "${n}"`);
    }
    if (!Array.isArray(s.actions) || s.actions.length === 0) {
      errors.push(`${at(i, s.id)}: actions must be a non-empty array`);
      return;
    }
    s.actions.forEach((a, j) => {
      const where = `${at(i, s.id)} action ${j + 1}`;
      if (!a || typeof a !== 'object' || !a.do) { errors.push(`${where}: missing "do"`); return; }
      if (!ACTIONS[a.do]) { errors.push(`${where}: unknown action "${a.do}" (see references/flow-authoring.md)`); return; }
      for (const req of ACTIONS[a.do]) {
        if (a[req] === undefined || a[req] === '') errors.push(`${where} ("${a.do}"): missing "${req}"`);
      }
      if (a.do === 'goto' && typeof a.path === 'string' && !a.path.startsWith('/')) {
        errors.push(`${where}: goto path must start with "/" (baseUrl is prepended)`);
      }
      if (a.do === 'goto' && !a.expect) warnings.push(`${where}: goto without "expect" — recording may race page load`);
      if (a.do === 'assert' && !a.urlIncludes && !a.urlExcludes && !a.textIncludes && !a.visible) {
        errors.push(`${where}: assert needs at least one of urlIncludes|urlExcludes|textIncludes|visible`);
      }
      if (a.do === 'extract') {
        if (!['url', 'text'].includes(a.from)) errors.push(`${where}: extract.from must be "url" or "text"`);
        try { new RegExp(a.match || ''); } catch { errors.push(`${where}: extract.match is not a valid regex`); }
        if (a.from === 'text' && !a.selector) errors.push(`${where}: extract from text needs "selector"`);
      }
      if ((a.do === 'type' || a.do === 'fill') && typeof a.text === 'string' && a.text.length > 60) {
        warnings.push(`${where}: typing ${a.text.length} chars takes a while on video — split or shorten`);
      }
      if (a.do === 'wait' && Number(a.ms) > 5000) warnings.push(`${where}: wait ${a.ms}ms is dead air — prefer assert with a condition`);
      if (a.do === 'click' && typeof a.selector === 'string' && /(_r_[a-z0-9_]+|nth-child)/.test(a.selector)) {
        warnings.push(`${where}: selector "${a.selector}" looks auto-generated/brittle — prefer stable ids or text`);
      }
      if (a.do === 'select' && a.value === undefined && a.label === undefined && a.index === undefined) {
        errors.push(`${where}: select needs one of value/label/index`);
      }
    });
  });

  // needs-cycle detection
  const byId = Object.fromEntries(flow.steps.filter((s) => s?.id).map((s) => [s.id, s]));
  const visiting = new Set();
  const done = new Set();
  const cycle = (id, trail) => {
    if (done.has(id)) return null;
    if (visiting.has(id)) return [...trail, id];
    visiting.add(id);
    for (const n of byId[id]?.needs || []) {
      const hit = cycle(n, [...trail, id]);
      if (hit) return hit;
    }
    visiting.delete(id);
    done.add(id);
    return null;
  };
  for (const id of Object.keys(byId)) {
    const hit = cycle(id, []);
    if (hit) { errors.push(`needs cycle: ${hit.join(' → ')}`); break; }
  }
  if (!flow.title) warnings.push('no title — video opens cold with no context card');
  if (flow.steps.length > 12) warnings.push(`${flow.steps.length} steps — long video; consider splitting into two flows`);

  // steps that re-execute on resume must be idempotent, never toggles
  const idxOf = (id) => flow.steps.findIndex((s) => s?.id === id);
  const replayable = new Set();
  for (const st of flow.steps) {
    const seen = new Set([st.id]);
    const stack = [...(st.needs || [])];
    while (stack.length) {
      const n = stack.pop();
      if (n === st.id || seen.has(n)) continue;
      seen.add(n);
      replayable.add(n);
      const target = flow.steps[idxOf(n)];
      for (const m of (target?.needs || [])) stack.push(m);
    }
  }
  for (const st of flow.steps) {
    // pick/fill/select set absolute values (idempotent by construction).
    if (!replayable.has(st.id)) continue;
    const acts = st.actions || [];
    const clicks = acts.some((a) => ['click', 'clickText'].includes(a.do));
    const navigates = acts.some((a) => a.do === 'assert' && (a.urlIncludes || a.urlExcludes));
    if (clicks && !navigates) {
      warnings.push(`${at(flow.steps.indexOf(st), st.id)}: replays on resume and its click doesn't navigate — if it's a toggle it will undo on retake; make it idempotent or navigating`);
    }
  }
  for (const st of flow.steps) {
    if (st.creates) {
      warnings.push(`${at(flow.steps.indexOf(st), st.id)}: creates server-side records — any retake including this step will duplicate; clean up afterwards or accept it`);
    }
  }

  // URL navigation is entry-only; in-flow travel clicks through the UI.
  // Sanctioned exceptions are marked: "direct": true + a _why note.
  flow.steps.forEach((st, i) => {
    for (const a of st.actions || []) {
      if (a.do !== 'goto' || i === 0) continue;
      if (!a.direct) {
        warnings.push(`${at(i, st.id)}: navigates by URL — click through the UI instead (flow-authoring.md: Navigation); mark sanctioned exceptions with "direct": true + a _why note`);
      } else if (!st._why) {
        warnings.push(`${at(i, st.id)}: direct goto without a _why note — special cases must say why the UI path can't be used`);
      }
    }
  });
  return { errors, warnings };
}

const hasAll = args.all === true || argv.includes('--all');
const names = hasAll
  ? readdirSync(join(ROOT, 'flows')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5))
  : [args.flow].filter(Boolean);
if (names.length === 0) {
  console.error('usage: node scripts/validate.mjs --flow <name> | --all');
  process.exit(2);
}
let failed = false;
for (const name of names) {
  const { errors, warnings } = validateFlow(name);
  if (errors.length === 0 && warnings.length === 0) {
    console.log(`✓ ${name}: valid`);
  } else {
    if (errors.length) {
      failed = true;
      console.log(`✗ ${name}: ${errors.length} error(s)`);
      for (const e of errors) console.log(`  ERROR  ${e}`);
    } else console.log(`✓ ${name}: valid`);
    for (const w of warnings) console.log(`  WARN   ${w}`);
  }
}
process.exit(failed ? 1 : 0);
