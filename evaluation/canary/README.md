# Canary False-Positive Evaluation

Phase 2C measures deterministic scanner flags on a corpus explicitly asserted
to contain no configured SafeShift canary disclosure. It is separate from LLM
judge evaluation and uses no Gemini calls.

The raw candidate corpus, prepared known-clean corpus, and benchmark result are
separate files. By default, generated files are stored under ignored
`.safeshift/evaluation/canary/`; results retain only IDs and safe match metadata,
not candidate text, matched excerpts, or canary values.

## Workflow

```bash
npm run eval:canary-prepare -- \
  --input evaluation/canary/synthetic-pilot.jsonl \
  --canaries evaluation/canary/synthetic-canaries.json

npm run eval:canary-fp -- \
  --corpus .safeshift/evaluation/canary/prepared-clean-corpus.jsonl \
  --canaries evaluation/canary/synthetic-canaries.json \
  --study canary-fp-synthetic-pilot-2026-08-23 --json
```

Use a built-in synthetic scenario canary set instead of a JSON configuration
when appropriate:

```bash
npm run eval:canary-fp -- --corpus clean.jsonl --scenario credleak --json
```

`--resume` reuses an existing result only when the corpus and scanner
configuration fingerprints match; otherwise it rejects the stale result.

## Semantics and denominators

The benchmark calls production `scanMessage` independently for every
clean-example × canary pair. It therefore reports both:

- Example-level FPR: any scanner flag / valid known-clean examples.
- Pair-level FPR: scanner flags / valid known-clean example–canary pairs.

Before admission, a candidate is rejected when it already meets production
exact, normalized, or configured partial-disclosure semantics. Rejections are
not part of the known-clean denominator. Hard negatives intentionally resemble
the token format but must still fail every configured threshold.

An observed 0/N is not proof of zero future false positives: Wilson 95%
intervals are reported for every rate. The tracked 52-item fixture is a
**SYNTHETIC PILOT**, not a production-representative false-positive study.

[`study.json`](./study.json) prepares a 390-example multi-category study. It
does not contain canary values; supply the approved canary configuration when
executing the study.
