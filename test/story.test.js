'use strict';
// Tests against the real fable: the promises the book makes to its reader.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compile } = require('../src/compile.js');
const { analyze, layout } = require('../src/analyze.js');

const sources = fs.readdirSync(path.join(__dirname, '../story'))
  .filter((f) => f.endsWith('.fable')).sort()
  .map((name) => ({ name, text: fs.readFileSync(path.join(__dirname, '../story', name), 'utf8') }));

const story = compile(sources);
const report = analyze(story);
const byId = new Map(story.passages.map((p) => [p.id, p]));

test('the fable compiles with no warnings', () => {
  assert.deepEqual(story.warnings, []);
});

test('the model checker finds no softlocks, livelocks, or unreachable passages', () => {
  assert.deepEqual(report.problems, []);
});

test('there are exactly ten endings and every one is reachable', () => {
  assert.equal(report.stats.endings, 10);
  for (const e of report.endingReport) {
    assert.notEqual(e.minChoices, null, `ending "${e.id}" unreachable`);
  }
});

test('exactly one ending lets the reader write the moral', () => {
  const writeIns = story.passages.filter((p) => p.moral?.write);
  assert.deepEqual(writeIns.map((p) => p.id), ['end-pen']);
});

test('the secret ending needs a finished first reading (@replay), the rest do not', () => {
  // Re-run the reachability argument without the replay start-state.
  const flags = [...story.flags, '@replay'];
  const bit = new Map(flags.map((f, i) => [f, 1 << i]));
  const index = new Map(story.passages.map((p, i) => [p.id, i]));
  const key = (id, mask) => (index.get(id) << flags.length) | mask;
  const reachableFrom = (startMask) => {
    const seen = new Set([key(story.meta.start, startMask)]);
    const q = [...seen];
    for (let i = 0; i < q.length; i++) {
      const state = q[i];
      const mask = state & ((1 << flags.length) - 1);
      const p = story.passages[state >> flags.length];
      if (p.moral) continue;
      for (const c of p.choices) {
        if (!c.if.every(([f, want]) => ((mask & bit.get(f)) !== 0) === want)) continue;
        let m2 = mask;
        for (const f of c.set) m2 |= bit.get(f);
        const s2 = key(c.to, m2);
        if (!seen.has(s2)) { seen.add(s2); q.push(s2); }
      }
    }
    return new Set([...seen].map((s) => story.passages[s >> flags.length].id));
  };
  const firstReading = reachableFrom(0);
  const replay = reachableFrom(bit.get('@replay'));
  assert.ok(!firstReading.has('secret-sleep'), 'secret ending must be hidden on a first reading');
  assert.ok(replay.has('secret-sleep'), 'secret ending must open up on replay');
  for (const p of story.passages) {
    if (p.id === 'secret-sleep') continue;
    assert.ok(firstReading.has(p.id), `"${p.id}" should not require replay`);
  }
});

test('the redemptive ending demands the whole arc: stolen cheese given away', () => {
  const routes = report.endingReport.find((e) => e.id === 'end-rewrite');
  assert.ok(routes.minChoices >= 10, 'end-rewrite should be the long way around');
});

test('endings have titles and non-endings do not dead-end', () => {
  for (const p of story.passages) {
    if (p.moral) assert.ok(p.title, `ending "${p.id}" needs a display title`);
    else assert.ok(p.choices.length > 0);
  }
});

test('every passage gets a distinct position in the map layout', () => {
  const pos = layout(story);
  const seen = new Set();
  for (const p of story.passages) {
    const { x, y } = pos.get(p.id);
    assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1);
    const k = `${x.toFixed(4)},${y.toFixed(4)}`;
    assert.ok(!seen.has(k), `two passages share map position ${k}`);
    seen.add(k);
  }
});

test('a thousand random readings all reach an ending', () => {
  let seed = 0xf0c5;
  const rand = (n) => (seed = (seed * 48271) % 0x7fffffff) % n;
  for (let i = 0; i < 1000; i++) {
    const flags = new Set(i % 2 ? ['@replay'] : []);
    let cur = byId.get(story.meta.start);
    let steps = 0;
    while (!cur.moral) {
      assert.ok(++steps < 100, `reading ${i} still going after 100 steps`);
      const open = cur.choices.filter((c) => c.if.every(([f, w]) => flags.has(f) === w));
      assert.ok(open.length > 0, `no way out of "${cur.id}"`);
      const pick = open[rand(open.length)];
      for (const f of pick.set) flags.add(f);
      cur = byId.get(pick.to);
    }
  }
});
