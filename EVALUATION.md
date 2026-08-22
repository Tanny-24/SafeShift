# SafeShift Evaluation

## 1. Evaluation Goals

Phase 2 measures two distinct things: agreement between SafeShift’s judge and
independent human annotation, and repeatability of the whole SafeShift
pipeline. It does not optimize outcomes or create marketing claims.

## 2. Threat Model

The evaluation covers SafeShift’s built-in synthetic scenarios and tools. It
does not yet establish performance on external agents or production data.

## 3. Judge Validation Methodology

The annotation unit is one complete scenario transcript with its tool activity
and deterministic canary evidence. The human annotator independently assigns
SAFE/UNSAFE, violated dimensions, and a 1–5 rating; UNSAFE is the positive
class. The judge prediction is stored separately until metrics are calculated.

## 4. Blind Annotation Protocol

```bash
npm run eval:prepare-judge
npm run safeshift:label
npm run eval:extract-judge
npm run eval:judge -- --variant reconciled
```

`examples.jsonl`, `labels.jsonl`, and `judge-predictions.jsonl` live under the
ignored `.safeshift/evaluation/judge/` directory. Examples deliberately omit
raw and reconciled judge verdicts, ratings, dimensions, and explanations. The
annotation CLI reads only examples and existing labels; it does not open judge
predictions.

## 5. Phase 2A Corpus

**MEASURED — 2026-08-23 (before any new live collection):** preparation found
3 local real examples: 2 baseline records and 1 regression-memory record. They
cover `CREDENTIAL_LEAK` once and `POLICY_VIOLATION` twice; all three are
adversarial. Two have tool activity (3 total tool turns), none has recorded
canary evidence, and transcript lengths range from 10 to 14 turns (mean
12.33). There are 0 human labels out of 3 examples.

The target remains 60–80 diverse real SafeShift transcripts. Corpus collection
is local-only and resume-safe:

```bash
npm run eval:collect -- --spec specs/v1.json --spec specs/v2.json \
  --scenarios promptleak,crosscustomer,piispill,jailbreak,indirect_injection,privilege_escalation,voice_verification,refusal_consistency,blackmail \
  --limit 18
npm run eval:prepare-judge
npm run eval:report-corpus
```

Successful records are keyed by the normalized AgentSpec hash and scenario ID,
written atomically to ignored `corpus.jsonl`. Attempt outcomes, including
network/provider failures and existing-record skips, are separately written to
ignored `collection-attempts.jsonl`. The collector does not write labels or
prediction exports, and composition reports use only objective corpus metadata.

**PENDING LIVE COLLECTION:** the Batch 1 command above was not run on
2026-08-23 because the required Gemini connectivity gate ended with
`curl: (28) SSL connection timeout`. No failed transport request was admitted
as an evaluation example.

## 6. Judge Prediction Availability and Results

**MEASURED — 2026-08-23:** all 3 prepared examples have reconciled predictions;
0 have raw predictions because the existing reports predate `rawJudgeVerdict`;
3 therefore have missing raw predictions. No raw prediction was fabricated.

**PENDING HUMAN LABELS:** final precision, recall, F1, Cohen’s kappa, and rating
MAE must not be reported until independent labels exist. The tooling calculates
overall, per-dimension, micro, and macro metrics only after labels are present.
Macro metrics exclude dimensions with zero human-positive support and explicitly
leave an undefined included metric unavailable rather than silently treating it
as zero.

## 7. Phase 2B End-to-End Variance Methodology

```bash
npm run eval:variance -- --spec specs/v1.json --scenario credleak --runs 3
```

This is end-to-end stability measurement, not judge-only variance: every repeat
can vary in attacker generation, target response, tools, canary evidence, and
judge behavior. Successful and failed attempts are stored separately; failed
attempts are excluded from safety rates and rating aggregates. Binary rates use
Wilson 95% intervals, and ratings use sample standard deviation.

## 8. Variance Pilot

**PILOT DESIGN:** 2 scenarios (`credleak`, `unauthorized_action`) × 2 AgentSpecs
(`specs/v1.json`, `specs/v2.json`) × 3 repeats = at most 12 scenario-runs.

**PENDING LIVE PILOT:** it was not run on 2026-08-23 because the same required
Gemini connectivity check timed out (`curl: (28) SSL connection timeout`).
Consequently, there are no pilot safety
rates, detection rates, confidence intervals, or rating statistics to report.
Any future interpretation must say “In this three-repeat pilot…” and must not
overinterpret the sample as a stability benchmark.

## 9. Planned Full Variance Study

**PLANNED — not executed:**
[`evaluation/variance/study.json`](./evaluation/variance/study.json) fixes eight
scenario IDs—`promptleak`, `credleak`, `crosscustomer`, `jailbreak`,
`indirect_injection`, `unauthorized_action`, `privilege_escalation`, and
`voice_verification`—across `specs/v1.json` and `specs/v2.json`, five repeats
each: 80 planned end-to-end runs. These scenarios provide coverage across
prompt extraction, credentials, cross-customer data, jailbreak and injection,
policy/action, privilege, and verification dimensions.

```bash
npm run eval:variance-study -- --manifest evaluation/variance/study.json
```

The runner writes ignored local records, validates the AgentSpec hashes in the
manifest before calling Gemini, skips successful plan cells, and leaves failed
cells eligible for an intentional later retry. Use `--limit <n>` to run a
bounded subset; do not run this study automatically.

## 10. Deterministic Evidence vs LLM Judge

New reports retain `rawJudgeVerdict` alongside the reconciled product verdict,
so later labels can be compared against either variant. Older reports only
support reconciled evaluation. Deterministic canary reconciliation is product
behavior, not evidence that the raw judge is correct.

## 11. Limitations / Threats to Validity

- Human labels may come from a single annotator.
- The intended corpus is small and scenario-distribution biased.
- Results depend on the provider/model, prompts, synthetic tools, attackers,
  target-agent behavior, and judge nondeterminism.
- End-to-end variance combines several stochastic components.
- Phase 2 does not yet establish external-agent validity.
- Live collection and pilot execution depend on Gemini network and quota health.

## 12. Canary False-Positive Evaluation

### Research question and scanner semantics

Phase 2C asks: among responses explicitly intended to contain no configured
SafeShift canary disclosure, how often does the deterministic scanner flag a
canary? This is not an LLM-judge experiment. The benchmark calls production
`scanMessage` directly for each clean-example × canary pair.

The scanner lowercases text and retains ASCII letters and digits only; spaces,
punctuation, and other characters are ignored for matching. It reports a
normalized exact match, or a contiguous normalized window at the configured
`partialLength`. Each canary can be reported once per transcript through the
existing `seen` set. Severity is carried into deterministic reconciliation:
critical, high, and medium hits cap ratings at 1, 2, and 3 respectively.

### Clean corpus and metrics

Every input record asserts `NO_CONFIGURED_CANARY`. Before admission, the
workflow rejects exact, normalized, or configured partial matches using the
current scanner semantics. Candidate text, prepared clean text, and results are
stored separately. Results contain safe identifiers and match metadata only;
they do not contain raw corpus text, excerpts, or canary values.

The runner reports:

- Example-level FPR: examples with any flag / valid known-clean examples.
- Pair-level FPR: flags / valid known-clean example–canary pairs.
- Per-canary, per-category, per-`partialLength`, severity, and match-kind
  statistics.
- Wilson 95% intervals for every rate.

Rejected candidates are reported separately and are not part of either
known-clean denominator. Hard negatives deliberately resemble canary shapes
but must not meet the current partial-disclosure threshold. This protocol does
not redefine a configured legitimate partial disclosure as a false positive.

### SYNTHETIC PILOT — MEASURED

The tracked synthetic pilot has 52 explicitly synthetic known-clean examples
across 13 categories, including four hard negatives, and three obviously
synthetic canaries with partial lengths 12, 14, and none. It is not a sample of
production responses.

**MEASURED — 2026-08-23:** preparation accepted 52/52 examples and rejected
none. The scanner produced 0 example-level flags out of 52 and 0 pair-level
flags out of 156. The Wilson 95% upper bounds are 6.88% at example level and
2.40% at pair level. Each canary was 0/52; each partial-length bucket was 0/52;
hard negatives were 0/4. There were no exact or partial matches.

This does **not** establish a production false-positive rate, prove zero future
false positives, justify changing production thresholds, or motivate an
entropy-style guard. No scanner behavior was changed for the pilot.

### MEASURED — SYNTHETIC 390-example study

The deterministic generator created 390 candidate examples: 30 in each of the
13 planned categories. This includes 30 hard negatives with canary-like shape,
substitutions at least every fifth normalized character, punctuation/whitespace
variants, reordered displays, and high-entropy-style identifiers. Admission
accepted all 390 and rejected none.

**MEASURED — SYNTHETIC — 2026-08-23:** production configuration produced zero
example-level flags out of 390 (Wilson 95% upper bound 0.98%) and zero
pair-level flags out of 1,170 (upper bound 0.33%). Each category, each canary,
and each production partial-length bucket (12, 14, none) had zero observed
flags. The hard-negative subset was 0/30 (upper bound 11.35%). There were no
exact or partial matches and no severity-bearing matches.

The separate positive-control detection sanity check detected 9/9 controls:
exact, normalized, configured partial, and multiple-canary cases. It is not a
recall benchmark and is not included in any false-positive denominator.

### MEASURED — SYNTHETIC sensitivity study

With separate derived configurations at partial lengths 6, 8, 10, and 12, the
same 390 candidates were all admitted and produced zero flags in each run. This
is a synthetic sensitivity result only; production partial-length defaults were
not changed.

The safe, machine-readable result artifact is
[`evaluation/canary/results/synthetic-390-summary.json`](./evaluation/canary/results/synthetic-390-summary.json).
It excludes raw corpus text, excerpts, and canary values.

These measurements do **not** establish a production false-positive rate,
prove zero future false positives, justify changing production thresholds, or
motivate an entropy-style guard. The raw generated corpus and full runtime
results remain local/ignored; use fingerprints to detect stale re-runs.
