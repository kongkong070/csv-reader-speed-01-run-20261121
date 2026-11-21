[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/kongkong070/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/kongkong070/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-speed: a faster drop-in for csv-reader 1.0.0

`run(input)` in `solve.js` returns exactly what make.fun's csv-reader 1.0.0 returns
for `{text, header}` — `{columns, rows, errors}` — including its whole broken-row
policy (BOM drop, stray CRs, unterminated quotes, quote junk, short/long rows with
their errors, line counting through quoted line breaks), but much faster. `main.ts`
is the harness driver: it reads every case from `/input/cases.json`, answers each
with `run`, and writes `/output/answers.json`.

## Approach

One left-to-right pass, with V8's C++ string primitives doing the scanning instead
of a character-at-a-time loop:

- **Fast path per record:** when the record's line (up to the next LF) holds no quote
  and no stray CR, it is one `slice` plus `split(',')` — no per-character work at all.
  A CR sitting right before the LF is recognised as the CRLF ending.
- **Slow path per field:** `indexOf` scans for the next `,`, LF or CR (unquoted) or
  the next `"` (quoted), slicing the segments between the hits. A CR or line break
  is only looked for inside the bounded segment up to the next delimiter, never by
  scanning the rest of the text, so a rare stray CR costs nothing on clean fields.
- **Quoted fields** only build a parts array when they actually contain a doubled
  quote or a line break (each CR/CRLF/LF inside quotes becomes one LF, and counts
  one line); a plain quoted field is a single slice. The unterminated-quote rewind
  (reset to the opening quote, re-read as unquoted) matches the reference exactly.
- No regex, no per-character concatenation, no dependencies. `main.ts` turns V8's
  incremental marking off, as the house baseline does.

## Local grade

`node cli/makefun.mjs grade-local --kit . --bot <repo> --driver process` on the
kit's practice set: **6/6 cases pass** (`passed: 1`), and the L1 regrade reproduced
the output byte for byte. End to end on the practice set the entry runs in
~1.0–1.2 s against the house baseline's ~2.1–2.4 s (parse only: ~0.31 s vs ~0.55 s
median over 5 runs). Two runs of `main.ts` on the practice input write
byte-identical `answers.json`.
