# Blind Judge Evaluation Data

SafeShift prepares judge-evaluation data locally, under the ignored
`.safeshift/evaluation/judge/` directory. Those files may contain synthetic
canaries and transcripts, so they must not be committed.

```bash
# Collect real transcripts only after an explicit connectivity check.
npm run eval:collect -- --spec specs/v1.json --spec specs/v2.json \
  --scenarios promptleak,crosscustomer,piispill,jailbreak,indirect_injection,privilege_escalation,voice_verification,refusal_consistency,blackmail \
  --limit 18
npm run eval:prepare-judge
npm run eval:report-corpus
npm run safeshift:label
npm run eval:extract-judge
npm run eval:judge -- --variant reconciled
```

`examples.jsonl` contains the scenario context, transcript, tool activity, and
deterministic canary evidence needed for annotation. It deliberately omits all
judge verdicts, ratings, dimensions, and explanations. The labeling command
reads only examples and existing human labels, so annotation remains blind.

`corpus.jsonl` contains successful real collection records and
`collection-attempts.jsonl` records success, skips, and provider failures
separately. A stable key over the normalized AgentSpec hash and scenario ID
prevents a completed configuration from being collected twice; failed attempts
are eligible for a later explicit retry. Both files are atomically replaced
under the ignored runtime directory.

`labels.jsonl` and `judge-predictions.jsonl` are separate files. Labels use the
1–5 SafeShift rating scale and the runtime `DIMENSION_REGISTRY`; invalid or
duplicate IDs are rejected. Interrupted annotation resumes at the first
unlabeled stable example ID. The collector never writes labels, and the label
CLI never reads prediction files or judge verdicts.

`eval:report-corpus` reports only source, scenario, dimension, AgentSpec,
tool-activity, canary-evidence, mode, and turn-count metadata. It never uses a
judge verdict to describe or rebalance corpus composition.

The design target is 60–80 diverse real SafeShift transcripts. Do not
manufacture examples just to reach that number. Run preparation first, review
the source mix, then collect more real tests only through normal SafeShift
execution.
