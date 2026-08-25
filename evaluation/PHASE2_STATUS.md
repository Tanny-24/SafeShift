# SafeShift Phase 2 Status

Status as of 2026-08-23. This is an engineering and measurement handoff, not a
product-performance claim.

| Area | Engineering | Empirical status | Remaining work |
|---|---|---|---|
| Phase 2A — judge validation | Complete | **MEASURED — REAL:** 21 transcripts; 0 human labels; metrics pending | Expand toward 60–80 real transcripts, perform blind annotation, then calculate raw/reconciled metrics. |
| Phase 2B — end-to-end variance | Complete | **MEASURED — REAL PILOT:** 12/12 successful runs; full study not run | Review the pilot, then explicitly run/resume the 80-run study later. |
| Phase 2C — canary false positives | Complete | 52-example synthetic pilot and 390-example synthetic known-clean study completed | Curate further diverse clean corpora if a broader empirical claim is needed. |

## Phase 2A

- Engineering: blind examples, separate labels/predictions, raw/reconciled
  extraction, metric tooling, and resumable real-corpus collector are ready.
- Corpus: **MEASURED — REAL:** Batch 1 attempted/succeeded/added 18/18/18,
  with 0 failures and 0 skips; the corpus is now 21 real local examples,
  targeting 60–80. It spans 11 scenario/dimension pairs, both selected specs,
  19 adversarial and 2 autonomous examples, 13 tool-active examples, and 2
  canary-evidence examples.
- Batch 2: **PENDING — REAL:** the required one connectivity check on each of
  2026-08-23 and 2026-08-25 ended with `curl: (28) SSL connection timeout`.
  The bounded collection command was not started, no Gemini call was retried,
  and the corpus remains at 21 examples.
- Human labels: 0.
- Prediction availability: 21 reconciled, 18 raw, 3 historical raw-unavailable,
  and 0 missing source records.
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
- Pilot: **MEASURED — REAL PILOT:** one connectivity gate returned HTTP 404,
  then `credleak` and `unauthorized_action` each ran against `v1` and `v2`
  three times. All 12 attempts succeeded; reconciled status was SAFE for all
  12, with no canary hits, detected dimensions, or observed rating variation
  (all ratings 5). Aggregate observed unsafe rate was 0/12 with a 95% Wilson
  interval of [0.00%, 24.25%]. This is end-to-end behavior, not judge-only
  variance or a general stability claim.
- Interpretation: the pilot does not invalidate a prior replay regression.
  Replay uses fixed historical adversarial input; the pilot uses fresh
  stochastic attacker, target, tool, and judge execution.
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

1. Collect the planned, not-yet-executed Batch 2 with the existing collector:
   `dataleak`, `insubordination`, `crescendo`, `encoding_bypass`,
   `memory_regurgitation`, `scope_creep`, `voice_authority`, `voice_language`,
   and `voice_optics_live` across `v1` and `v2` (18 maximum runs).
2. After Batch 2, use objective composition metadata to select—without
   executing—a Batch 3 plan. Batch 3 is intentionally unplanned while Batch 2
   has no measurement.
3. Perform blind human annotation; do not use model predictions as labels.
4. Calculate raw and reconciled judge metrics only after annotation.
5. Review the 12-run pilot, then explicitly run/resume the 80-run study when
   ready; it was not run in this session.
6. Decide whether a non-synthetic Phase 2C clean-response corpus is needed for
   a broader false-positive claim.

## Completion definition

**PHASE 2 ENGINEERING COMPLETE — EMPIRICAL WORK PARTIAL.** Phase 2 must not be
called complete until real judge labels/metrics and Gemini-backed variance
measurements are available.
