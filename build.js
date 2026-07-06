#!/usr/bin/env node
'use strict';
// build.js — compile the fable, prove it sound, and press it into a single
// self-contained dist/index.html. Usage:
//
//   node build.js            build dist/index.html
//   node build.js --check    compile + verify only (CI mode, writes nothing)
//   node build.js --paths    also print the shortest route to every ending
//
// No dependencies. Node 18+.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { compile } = require('./src/compile.js');
const { analyze, layout } = require('./src/analyze.js');

const ROOT = __dirname;
const args = new Set(process.argv.slice(2));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- compile ---------------------------------------------------------------
const sources = fs.readdirSync(path.join(ROOT, 'story'))
  .filter((f) => f.endsWith('.fable')).sort()
  .map((name) => ({ name: `story/${name}`, text: read(`story/${name}`) }));

let story;
try {
  story = compile(sources);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}
for (const w of story.warnings) console.warn(`⚠ ${w}`);

// ---- verify ----------------------------------------------------------------
const report = analyze(story);
if (!report.ok) {
  for (const p of report.problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const s = report.stats;
console.log(`“${story.meta.title}” — sound.`);
console.log(`  ${s.passages} passages · ${s.words.toLocaleString()} words · ${s.choices} choices · ${s.flags} flags · ${s.endings} endings`);
console.log(`  model check: ${s.reachableStates.toLocaleString()} reachable states, no softlocks, no livelocks, every moral feedable`);

if (args.has('--paths')) {
  console.log('\n  shortest route to each ending:');
  for (const e of report.endingReport.sort((a, b) => a.minChoices - b.minChoices)) {
    console.log(`  · ${String(e.minChoices).padStart(2)} choices — ${e.title}`);
    console.log(`      ${e.example.map((l) => l.replace(/<[^>]+>/g, '')).join('  →  ')}`);
  }
}

if (args.has('--check')) {
  console.log('\n--check: verified, nothing written.');
  process.exit(0);
}

// ---- press -----------------------------------------------------------------
const pos = layout(story);
for (const p of story.passages) p.pos = pos.get(p.id);
story.meta.version = crypto.createHash('sha256')
  .update(JSON.stringify(story)).digest('hex').slice(0, 12);

const fox = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><g fill='%23a84e17'><path d='M18 12 L40 34 L14 46 Z'/><path d='M82 12 L60 34 L86 46 Z'/><path d='M50 26 L84 48 L50 94 L16 48 Z'/></g><g fill='%23f5efe3'><circle cx='38' cy='52' r='3.2'/><circle cx='62' cy='52' r='3.2'/><path d='M50 76 L56 68 L44 68 Z'/></g></svg>`;
const meta = [
  `<title>${story.meta.title}</title>`,
  `<meta name="description" content="${story.meta.subtitle} — one morning, ten endings. By ${story.meta.author}.">`,
  `<link rel="icon" href="data:image/svg+xml,${fox}">`,
  `<meta property="og:title" content="${story.meta.title}">`,
  `<meta property="og:description" content="A fable with choices. Every ending must feed a moral; what feeds it is up to you.">`,
].join('\n');

const storyJson = JSON.stringify(story).replace(/</g, '\\u003c');
const html = read('src/template.html')
  .replace('<!--META-->', meta)
  .replace('<!--STYLE-->', read('src/style.css'))
  .replace('/*STORY*/', storyJson)
  .replace('<!--RUNTIME-->', read('src/runtime.js'));

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/index.html'), html);
const kb = (fs.statSync(path.join(ROOT, 'dist/index.html')).size / 1024).toFixed(1);
console.log(`\npressed → dist/index.html (${kb} KB, self-contained, version ${story.meta.version})`);
