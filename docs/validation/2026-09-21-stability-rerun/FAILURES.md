# 11 non-passing cells — fresh-run original verdicts

[Result summary](README.md) · [한국어](FAILURES_KO.md) · [Observation JSON](failure-analysis.json)

These post-run observations do not change original verdicts or cause categories. Raw paths are `.runtime/stability-rerun-20260921/live/cases/<model>/<scenario>/`: consult `oracle.json`, `observation.json`, `resources.json` and the validated pointers in the observation JSON. Hashes are in the [evidence manifest](evidence-manifest.json).

| Model | ID | Original status | Failed checks | Observations |
|---|---|---|---|---|
| claude-opus-5 | S01 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S01.once` | Structured SDK filter signals: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S02 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S02.once`, `S02.permutation` | Structured SDK filter signals: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S03 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S03.once`, `S03.reject` | Structured SDK filter signals: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S04 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S04.once`, `S04.retry` | Structured SDK filter signals: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S05 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S05.once` | Structured SDK filter signals: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S06 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S06.recovery`, `S06.deadline` | Structured SDK filter signals: 2; upstream_content_filter responses=2; ACK-hold=1; fault=4078ms |
| claude-opus-5 | S07 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S07.loss`, `S07.isolation` | Structured SDK filter signals: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S08 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S08.recovery`, `S08.loss`, `S08.no-replay` | Structured SDK filter signals: 2; upstream_content_filter responses=2 |
| claude-opus-5 | S09 | failed | `turns`, `stream`, `transport-outcomes`, `tool-correlation`, `final-values`, `readiness`, `S09.recovery`, `S09.invalid-stream` | Structured SDK filter signals: 2; upstream_content_filter responses=2 |
| claude-opus-5 | S10 | failed | `turns`, `transport-outcomes`, `final-values`, `readiness`, `S10.resume` | Structured SDK filter signals: 1; upstream_content_filter responses=1 |
| claude-opus-5 | S11 | failed | `turns`, `transport-outcomes`, `readiness`, `S11.compaction`, `S11.repetition` | Structured SDK filter signals: 1; upstream_content_filter responses=1; reads=[1,0,0,0,0,0] |

## Complete matrix

P = passed, F = failed.

| Model | S01 | S02 | S03 | S04 | S05 | S06 | S07 | S08 | S09 | S10 | S11 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-5.6-sol | P | P | P | P | P | P | P | P | P | P | P |
| gpt-5.6-terra | P | P | P | P | P | P | P | P | P | P | P |
| gpt-5.6-luna | P | P | P | P | P | P | P | P | P | P | P |
| gpt-6-astra | P | P | P | P | P | P | P | P | P | P | P |
| claude-opus-5 | F | F | F | F | F | F | F | F | F | F | F |
| claude-sonnet-5 | P | P | P | P | P | P | P | P | P | P | P |
| claude-haiku-4.5 | P | P | P | P | P | P | P | P | P | P | P |
