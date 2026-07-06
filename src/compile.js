'use strict';
// compile.js — turns .fable source into a story object.
//
// The .fable format, in full:
//
//   @title  Exit, Pursued by a Moral      file-level metadata (first file wins)
//   @subtitle a fable with choices
//   @author Claude Fable 5
//   @start  wake
//
//   // a comment line, ignored
//
//   :: passage-id | Optional Display Title
//   Body paragraphs, separated by blank lines. *em* and **strong** allowed.
//   ~if flag: this paragraph renders only when `flag` is set
//   ~if !flag ~if other: conditions AND together
//
//   @moral Text of the moral.        marks this passage as an ending
//   @moral write                     an ending whose moral the reader writes
//
//   * [Choice label] -> target-id
//   * [Guarded choice] -> target ~if flag ~if !other ~set gained-thing
//
// The flag `@replay` is set by the runtime when the reader has already
// found at least one ending; stories may guard on it but never set it.

const RUNTIME_FLAGS = new Set(['@replay']);

class CompileError extends Error {
  constructor(message, file, line) {
    super(file ? `${file}:${line}: ${message}` : message);
    this.name = 'CompileError';
  }
}

function parseConditions(tokens, ctx) {
  // tokens like ["if x", "if !y", "set z"] (already split on "~")
  const ifs = [];
  const sets = [];
  for (const raw of tokens) {
    const tok = raw.trim();
    if (!tok) continue;
    let m;
    if ((m = tok.match(/^if\s+(!?)([@a-z0-9-]+)$/))) {
      ifs.push([m[2], m[1] !== '!']);
    } else if ((m = tok.match(/^set\s+([@a-z0-9-]+)$/))) {
      if (m[1].startsWith('@')) throw new CompileError(`flag "${m[1]}" is reserved for the runtime — stories cannot ~set it`, ctx.file, ctx.line);
      sets.push(m[1]);
    } else {
      throw new CompileError(`unrecognized modifier "~${tok}"`, ctx.file, ctx.line);
    }
  }
  return { ifs, sets };
}

function inlineMarkup(text) {
  // **strong** then *em*; escape HTML first. Authors write real Unicode
  // punctuation (curly quotes, em dashes) directly in the source.
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function compile(sources) {
  // sources: [{ name, text }, ...]
  const meta = { title: null, subtitle: null, author: null, start: null };
  const passages = [];
  const byId = new Map();
  let current = null;
  let paragraphBuffer = [];
  let ctx = { file: '', line: 0 };

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const joined = paragraphBuffer.join(' ');
    paragraphBuffer = [];
    let m = joined.match(/^((?:~if\s+!?[@a-z0-9-]+\s*)+):\s*(.*)$/);
    if (m) {
      const { ifs, sets } = parseConditions(m[1].split('~'), ctx);
      if (sets.length) throw new CompileError('~set is not allowed on body text', ctx.file, ctx.line);
      current.body.push({ text: inlineMarkup(m[2]), if: ifs });
    } else {
      current.body.push({ text: inlineMarkup(joined), if: [] });
    }
  };

  for (const src of sources) {
    const lines = src.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      ctx = { file: src.name, line: i + 1 };
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('//')) continue;

      let m;
      if ((m = trimmed.match(/^::\s*([a-z0-9-]+)\s*(?:\|\s*(.+))?$/))) {
        if (current) flushParagraph();
        if (byId.has(m[1])) throw new CompileError(`duplicate passage id "${m[1]}"`, ctx.file, ctx.line);
        current = { id: m[1], title: m[2] ? m[2].trim() : null, body: [], choices: [], moral: null, src: ctx };
        byId.set(m[1], current);
        passages.push(current);
        continue;
      }

      if ((m = trimmed.match(/^@(title|subtitle|author|start)\s+(.+)$/)) && !current) {
        if (meta[m[1]] === null) meta[m[1]] = m[2].trim();
        continue;
      }

      if (!trimmed) { if (current) flushParagraph(); continue; }

      if (!current) throw new CompileError(`text outside of any passage: "${trimmed}"`, ctx.file, ctx.line);

      if ((m = trimmed.match(/^@moral\s+(.+)$/))) {
        if (current.moral) throw new CompileError(`passage "${current.id}" has two morals`, ctx.file, ctx.line);
        const text = m[1].trim();
        current.moral = text === 'write' ? { write: true } : { text: inlineMarkup(text) };
        continue;
      }

      if ((m = trimmed.match(/^\*\s*\[([^\]]+)\]\s*->\s*([a-z0-9-]+)\s*(.*)$/))) {
        flushParagraph();
        const { ifs, sets } = parseConditions(m[3].split('~'), ctx);
        current.choices.push({ label: inlineMarkup(m[1].trim()), to: m[2], if: ifs, set: sets, src: ctx });
        continue;
      }
      if (/^\*\s|^\*\[/.test(trimmed)) {
        throw new CompileError(`malformed choice line: "${trimmed}"`, ctx.file, ctx.line);
      }
      if (trimmed.startsWith('@')) {
        throw new CompileError(`unknown directive: "${trimmed}"`, ctx.file, ctx.line);
      }

      // A line opening with ~if always starts a fresh paragraph, so stacked
      // conditional lines don't silently merge into one.
      if (/^~if\s/.test(trimmed)) flushParagraph();
      paragraphBuffer.push(trimmed);
    }
    if (current) flushParagraph();
  }

  if (!meta.title) throw new CompileError('missing @title');
  if (!meta.start) throw new CompileError('missing @start');
  if (!byId.has(meta.start)) throw new CompileError(`@start passage "${meta.start}" does not exist`);

  // Structural validation.
  const flagsSet = new Set();
  const flagsRead = new Set();
  for (const p of passages) {
    if (!p.body.length) throw new CompileError(`passage "${p.id}" has no body`, p.src.file, p.src.line);
    if (p.choices.length === 0 && !p.moral)
      throw new CompileError(`passage "${p.id}" has no choices and no @moral — dead end`, p.src.file, p.src.line);
    if (p.choices.length > 0 && p.moral)
      throw new CompileError(`passage "${p.id}" has a @moral but also has choices — endings must be final`, p.src.file, p.src.line);
    for (const c of p.choices) {
      if (!byId.has(c.to)) throw new CompileError(`choice points to missing passage "${c.to}"`, c.src.file, c.src.line);
      for (const f of c.set) flagsSet.add(f);
      for (const [f] of c.if) flagsRead.add(f);
    }
    for (const b of p.body) for (const [f] of b.if) flagsRead.add(f);
  }
  for (const f of flagsRead) {
    if (!flagsSet.has(f) && !RUNTIME_FLAGS.has(f))
      throw new CompileError(`flag "${f}" is read but never set by any choice`);
  }

  const warnings = [];
  for (const f of flagsSet) if (!flagsRead.has(f)) warnings.push(`flag "${f}" is set but never read`);

  // Strip source positions from the shipped object.
  const out = passages.map((p) => ({
    id: p.id, title: p.title, body: p.body,
    choices: p.choices.map(({ label, to, if: ifs, set }) => ({ label, to, if: ifs, set })),
    moral: p.moral,
  }));

  return {
    meta: { ...meta },
    passages: out,
    flags: [...flagsSet].sort(),
    warnings,
  };
}

module.exports = { compile, CompileError, RUNTIME_FLAGS };
