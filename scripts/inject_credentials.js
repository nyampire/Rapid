/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

// Generates `index.html` (dev) and `dist/index.html` (prod) from their
// committed `.template` files by substituting the OSM OAuth2 client
// credentials from the environment (loaded by dotenvx in the npm script).
//
// Rationale: hard-coding these in the committed HTML files generated a
// merge conflict every time the upstream `facebook/Rapid` repo updated
// its own keys. Closes nyampire/Rapid#7.

const PLACEHOLDERS = [
  'OSM_CLIENT_ID',
  'OSM_CLIENT_SECRET',
  'OSM_DEV_CLIENT_ID',
  'OSM_DEV_CLIENT_SECRET'
];

const TARGETS = [
  { template: 'index.html.template',      output: 'index.html' },
  { template: 'dist/index.html.template', output: 'dist/index.html' }
];

function loadValues() {
  const missing = [];
  const values = {};
  for (const key of PLACEHOLDERS) {
    const v = process.env[key];
    if (!v) {
      missing.push(key);
    } else {
      values[key] = v;
    }
  }
  if (missing.length) {
    console.error('Missing required env vars: ' + missing.join(', '));
    console.error('Create a .env file (see .env.example) or set these in the environment before building.');
    process.exit(1);
  }
  return values;
}

function injectOne({ template, output }, values) {
  const tplPath = path.resolve(template);
  if (!fs.existsSync(tplPath)) {
    console.error('Template not found: ' + template);
    process.exit(1);
  }
  let content = fs.readFileSync(tplPath, 'utf8');
  for (const key of PLACEHOLDERS) {
    const placeholder = '__' + key + '__';
    content = content.split(placeholder).join(values[key]);
  }
  // After substitution, no placeholder should remain.
  const remaining = content.match(/__OSM_[A-Z_]+__/g);
  if (remaining) {
    console.error('Unresolved placeholders in ' + output + ': ' + remaining.join(', '));
    process.exit(1);
  }
  // Make sure the output directory exists (dist/ may not be present on a fresh clone).
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), content);
  console.log('Wrote ' + output);
}

const values = loadValues();
for (const target of TARGETS) {
  injectOne(target, values);
}
