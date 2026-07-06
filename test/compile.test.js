'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compile, CompileError } = require('../src/compile.js');

const src = (text) => [{ name: 'test.fable', text }];
const HEAD = '@title T\n@start a\n';

test('parses passages, choices, sets and guards', () => {
  const story = compile(src(`${HEAD}
:: a
Hello *world*.

* [Go on] -> b ~set seen
* [Secret path] -> b ~if seen

:: b
Done.
@moral The end.
`));
  assert.equal(story.meta.title, 'T');
  const a = story.passages.find((p) => p.id === 'a');
  assert.equal(a.body[0].text, 'Hello <em>world</em>.');
  assert.deepEqual(a.choices[0], { label: 'Go on', to: 'b', if: [], set: ['seen'] });
  assert.deepEqual(a.choices[1].if, [['seen', true]]);
  assert.equal(story.passages.find((p) => p.id === 'b').moral.text, 'The end.');
});

test('conditional body paragraphs, including negation and multi-line', () => {
  const story = compile(src(`${HEAD}
:: a
~if x: only when x.
~if !x ~if y: when y but not x,
even across a wrapped line.
* [go] -> b ~set x ~set y

:: b
Done.
@moral m
`));
  const [b1, b2] = story.passages[0].body;
  assert.deepEqual(b1.if, [['x', true]]);
  assert.deepEqual(b2.if, [['x', false], ['y', true]]);
  assert.match(b2.text, /wrapped line/);
});

test('@moral write produces a write-in ending', () => {
  const story = compile(src(`${HEAD}\n:: a\nx\n* [go] -> b\n:: b\ny\n@moral write\n`));
  assert.deepEqual(story.passages[1].moral, { write: true });
});

test('escapes HTML in body and choices', () => {
  const story = compile(src(`${HEAD}\n:: a\n<script>alert(1)</script>\n* [a <b> c] -> b\n:: b\ny\n@moral m\n`));
  assert.match(story.passages[0].body[0].text, /&lt;script&gt;/);
  assert.match(story.passages[0].choices[0].label, /&lt;b&gt;/);
});

const rejects = (name, text, re) =>
  test(`rejects ${name}`, () => assert.throws(() => compile(src(text)), (e) => e instanceof CompileError && re.test(e.message)));

rejects('duplicate passage ids', `${HEAD}\n:: a\nx\n@moral m\n:: a\ny\n@moral m\n`, /duplicate/);
rejects('choices to missing passages', `${HEAD}\n:: a\nx\n* [go] -> nowhere\n`, /missing passage "nowhere"/);
rejects('a dead end (no choices, no moral)', `${HEAD}\n:: a\nstuck.\n`, /dead end/);
rejects('a moral on a passage with choices', `${HEAD}\n:: a\nx\n@moral m\n* [go] -> a\n`, /must be final/);
rejects('reading a flag nothing sets', `${HEAD}\n:: a\n~if ghost: boo\n@moral m\n`, /read but never set/);
rejects('setting the runtime flag', `${HEAD}\n:: a\nx\n* [go] -> a ~set @replay\n`, /reserved for the runtime/);
rejects('a missing @start passage', `@title T\n@start zzz\n:: a\nx\n@moral m\n`, /does not exist/);
rejects('malformed choice lines', `${HEAD}\n:: a\nx\n* [go] > b\n`, /malformed choice/);
rejects('unknown modifiers', `${HEAD}\n:: a\nx\n* [go] -> a ~frob x\n`, /unrecognized modifier/);
