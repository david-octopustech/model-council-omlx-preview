# Council — multi-model deliberation for hard judgment calls

A council is a structured way to get several AI models' independent answers to the same
question, then combine them into something better than any single one — by active selection,
not by averaging.

I use this pattern on real judgment calls where I don't fully trust a single model's answer.
This repo documents the pattern and ships the working code behind it — it's a reference,
not a maintained framework. Take what's useful, adapt the rest.

## Why a council instead of one model?

A single model gives you one answer, stated with total confidence regardless of how
contested the question actually is. On **judgment calls without a checkable answer** —
go/no-go decisions under uncertainty, methodology critiques, strategic trade-offs — a
council tells you where the real disagreement lives and whether it resolved for a good
reason or just because one voice was loudest.

The key insight: **parallel independent answers that converge on the same conclusion are
real signal**. One model following another's lead is not. The three-stage structure
(dispatch → optional anonymized peer review → chairman synthesis) is designed to make
convergence meaningful and to actively catch bad answers rather than quietly blending them
in.

For the full treatment — when it's worth the cost, the two failure modes to avoid, and the
operational details — see [`docs/pattern.md`](docs/pattern.md).

## Repository structure

```
docs/
  pattern.md             — the council pattern: why, when, and the three stages
  workflow.md            — step-by-step operational workflow
  member_registry.md     — template for tracking which models serve as seats
  scorecard_schema.md    — schema for keeping a running track record

council/
  bedrock_member.py      — AWS Bedrock seat implementation (Converse API)
  run_council.py         — minimal orchestrator wiring the three stages together
```

## Quick start

### Prerequisites

- **Python 3.10+**
- **boto3** (`pip install boto3`)
- **AWS credentials** configured as a named profile called `council-bedrock`:
  ```
  aws configure --profile council-bedrock
  ```
  The IAM user/role needs invoke-only Bedrock permissions in `us-east-1`.

### Call a single seat

```bash
python -m council.bedrock_member --ask "What are the trade-offs of event sourcing vs CRUD?"
python -m council.bedrock_member --ask "..." --model deepseek-v3.2 --show-thinking
```

### Run a full council

```bash
# 2-stage (dispatch + synthesis, no peer review):
python -m council.run_council \
  --ask "Evaluate this architecture proposal: ..." \
  --seats nova-pro,nova-lite,deepseek-v3.2 \
  --no-review

# 3-stage (with anonymized peer review):
python -m council.run_council \
  --ask "..." \
  --seats nova-pro,deepseek-v3.2,kimi-k2 \
  --reviewers nova-pro,deepseek-v3.2
```

### Use as a library

The orchestrator accepts any callable with the signature `(prompt: str) -> str` as a seat.
You're not locked into Bedrock — wrap any API, local model, or mock:

```python
from council.run_council import run_council

def my_custom_seat(prompt: str) -> str:
    # call your model here
    return "the answer"

result = run_council(
    question="your question",
    seats=[my_custom_seat, another_seat],
    chair=strongest_seat,
    reviewers=[reviewer_a, reviewer_b],  # omit for 2-stage
)

print(result.synthesis)
print(result.summary())  # full markdown report
```

## Available Bedrock models

The included `bedrock_member.py` supports these models out of the box (verify IDs with
`list_foundation_models` — they rotate as providers ship new versions):

| Alias | Model ID | Notes |
|---|---|---|
| `nova-pro` | `amazon.nova-pro-v1:0` | Default seat |
| `nova-lite` | `amazon.nova-lite-v1:0` | Cheaper tier |
| `nova2-lite` | `us.amazon.nova-2-lite-v1:0` | Newer cheap tier |
| `deepseek-v3.2` | `deepseek.v3.2` | Reasoning model |
| `llama4-maverick` | `us.meta.llama4-maverick-17b-instruct-v1:0` | |
| `llama4-scout` | `us.meta.llama4-scout-17b-instruct-v1:0` | |
| `devstral` | `mistral.devstral-2-123b` | Code-specialized |
| `gpt-oss-120b` | `openai.gpt-oss-120b-1:0` | Reasoning model |
| `qwen3-coder` | `qwen.qwen3-coder-next` | Code-specialized |
| `kimi-k2` | `moonshot.kimi-k2-thinking` | Reasoning model |
| `kimi-k2.5` | `moonshotai.kimi-k2.5` | Reasoning (frontier) |

## Keeping a scorecard

Over time, the council is only as good as the track record you keep on it. The
[`scorecard_schema.md`](docs/scorecard_schema.md) defines a lightweight schema for logging
which seats performed well on which task types. Keep your own rows in your own copy — don't
commit real scorecard data to a public repo.

## Further reading

- [The council pattern](docs/pattern.md) — why and when
- [Operational workflow](docs/workflow.md) — step by step
- [Member registry template](docs/member_registry.md) — tracking your seats
- [Scorecard schema](docs/scorecard_schema.md) — tracking your results

## License

MIT — see [LICENSE](LICENSE).
