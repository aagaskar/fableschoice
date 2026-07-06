# Fable's Choice

Interactive fiction: “Exit, Pursued by a Moral,” plus its zero-dependency engine.
No npm, no node_modules, ever. Node 18+ only.

## Commands
- `node build.js` — compile + model-check + write `dist/index.html` (commit dist; CI fails if stale)
- `node build.js --check` — verify only; `--paths` — print shortest route to each ending
- `node --test` — engine grammar tests + story-promise tests

## Layout
- `story/*.fable` — the fable, plain text. **Source of truth for all prose.** Format guide in README.
- `src/compile.js` — parser/validator; `src/analyze.js` — state-space model checker + map layout
- `src/runtime.js`, `src/style.css`, `src/template.html` — the reader, inlined at build time
- `dist/index.html` — the whole book, one file (generated — never edit by hand)

## Rules of the country
- Endings = passages with `@moral` and no choices; everything else must have a choice
- `@replay` is runtime-set (reader has ≥1 ending); stories may `~if` it, never `~set` it
- Duplicate choice labels+targets with different guards collapse at runtime (that's how OR works)
- After story edits, run `node --test && node build.js` — the model checker must stay green
  (all 10 endings reachable, no softlocks/livelocks); update test counts if endings change
- Prose style: real Unicode punctuation (curly quotes, em dashes) typed directly in .fable files
