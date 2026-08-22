# SafeShift Phase 2 Status

Status as of 2026-08-23. This is an engineering and measurement handoff, not a
product-performance claim.

| Area | Engineering | Empirical status | Remaining work |
|---|---|---|---|
| Phase 2A — judge validation | Complete | 3 real transcripts; 0 human labels; metrics pending | Collect 60–80 real transcripts, perform blind annotation, then calculate raw/reconciled metrics. |
| Phase 2B — end-to-end variance | Complete | No live pilot or full-study result yet | Run the 12-run pilot when Gemini connectivity is healthy; later run/resume the 80-run study. |
| Phase 2C — canary false positives | Complete | 52-example synthetic pilot and 390-example synthetic known-clean study completed | Curate further diverse clean corpora if a broader empirical claim is needed. |

## Phase 2A

- Engineering: blind examples, separate labels/predictions, raw/reconciled
  extraction, metric tooling, and resumable real-corpus collector are ready.
- Corpus: 3 real local examples, target 60–80.
- Human labels: 0.
- Metrics: **PENDING HUMAN LABELS**.

```bash
npm run eval:collect -- --spec specs/v1.json --spec specs/v2.json \
  --scenarios promptleak,crosscustomer,piispill,jailbreak,indirect_injection,privilege_escalation,voice_verification,refusal_consistency,blackmail \
  --limit 18
npm run eval:prepare-judge
npm run safeshift:label
npm run eval:extract-judge
npm run eval:judge -- --variant reconciled
```

## Phase 2B

- Engineering: failure-aware one-off pilot runner, resumable manifest runner,
  Wilson intervals, and rating variability statistics are ready.
- Pilot: **PENDING GEMINI CONNECTIVITY**. The one connectivity check on
  2026-08-23 ended with `curl: (28) SSL connection timeout`; no live run was
  attempted or retried.
- Full study: 80 planned end-to-end runs in
  [`variance/study.json`](./variance/study.json); successful plan cells resume
  safely and failures remain intentionally retryable.

```bash
npm run eval:variance -- --spec specs/v1.json --scenario credleak --runs 3
npm run eval:variance-study -- --manifest evaluation/variance/study.json
```

## Phase 2C

- Engineering: clean-corpus schema/admission, safe result fingerprints,
  hard-negative support, example/pair FPR, strata, positive controls, and
  non-production sensitivity analysis are complete.
- Synthetic pilot: 52 valid synthetic examples, 0 observed flags.
- 390-example study: 390 valid synthetic examples, 0 observed flags across
  1,170 pairs; 30 hard negatives; 9/9 positive controls detected.
- Production representativeness: **NOT ESTABLISHED**. The results are
  synthetic, and zero observed flags does not mean zero future false positives.

The sanitized reproducible result is
[`canary/results/synthetic-390-summary.json`](./canary/results/synthetic-390-summary.json).

## Remaining actions requiring Tanuja

1. Restore/confirm Gemini connectivity and collect the real Phase 2A corpus.
2. Perform blind human annotation; do not use model predictions as labels.
3. Run the 12-run three-repeat end-to-end Phase 2B pilot once.
4. Decide whether a non-synthetic Phase 2C clean-response corpus is needed for
   a broader false-positive claim.

## Completion definition

**PHASE 2 ENGINEERING COMPLETE — EMPIRICAL WORK PARTIAL.** Phase 2 must not be
called complete until real judge labels/metrics and Gemini-backed variance
measurements are available.
