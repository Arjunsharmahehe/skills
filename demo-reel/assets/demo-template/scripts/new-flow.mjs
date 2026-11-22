#!/usr/bin/env node
// .demo-reel new-flow — scaffold a valid flow JSON.
//
//   node scripts/new-flow.mjs <name>
import { writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const name = (process.argv[2] || '').replace(/[^a-z0-9-_]/gi, '').toLowerCase();
if (!name) {
  console.error('usage: node scripts/new-flow.mjs <name>');
  process.exit(2);
}
const path = join(ROOT, 'flows', `${name}.json`);
if (existsSync(path) && !process.argv.includes('--force')) {
  console.error(`${path} exists — pass --force to overwrite`);
  process.exit(1);
}
const template = {
  name,
  title: `Demo: ${name}`,
  subtitle: 'Recorded proof',
  task: `record the ${name} flow`,
  baseUrl: 'https://example.com',
  zoom: 90,
  steps: [
    {
      id: 'open',
      chapter: 'open the page',
      caption: 'Opening the page',
      actions: [{ do: 'goto', path: '/', expect: 'body' }],
    },
    {
      id: 'act',
      chapter: 'perform the key action',
      caption: 'Performing the key action',
      needs: ['open'],
      actions: [{ do: 'wait', ms: 800 }],
    },
  ],
};
writeFileSync(path, JSON.stringify(template, null, 2) + '\n');
console.log(`wrote ${path}\nnext:\n  1. edit baseUrl + steps for your feature\n  2. validate: node scripts/validate.mjs --flow ${name}\n  3. record:    node scripts/record.mjs --flow ${name}`);
