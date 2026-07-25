# Running a council, step by step

This is the operational workflow: what actually happens, in order, when you convene a
council on a real question. Pairs with [`pattern.md`](pattern.md) (the why) and
[`member_registry.md`](member_registry.md) (the who).

## 0. Guardrails, checked before anything else

- **Decide a council is actually warranted** (see [`pattern.md`](pattern.md)'s "when it's worth
  it" section). If the answer is checkable, don't convene a council, verify directly instead.
- **Decide your sensitivity posture up front, once, and stick to it for the whole run.** If
  the question involves anything you would not want to leave your own control (confidential
  business information, personal data, anything under an NDA), restrict seats to providers
  you have an explicit trust/data-handling basis for, and never route that content through a
  provider you haven't cleared for it. Decide this before Stage 1, not mid-run.
- **Strip identifiers before anything goes to a third-party API**, even in the non-sensitive
  case: account numbers, personal names, internal paths, anything that would mean something
  to someone paying attention. This is a habit worth having regardless of stakes.
- **Give every seat an explicit isolation instruction**: work only from the brief provided,
  no tools, no file access, no exploring, unless the seat's actual job requires it. State
  this up front in every seat's prompt, don't assume it.

## 1. Convene — pick the configuration

Decide: how many seats, which models, 2-stage (answer → synthesize) or 3-stage (answer →
anonymized peer review → synthesize). Use [`member_registry.md`](member_registry.md)'s
starting-point table, then adjust against your own scorecard evidence as it accumulates.

Write one brief: the actual question, the motivation behind it, and what a good answer
looks like (acceptance criteria / report format). Every seat gets the identical brief. The
brief should not hint that other seats exist or what they might say.

## 2. Stage 1 — parallel answers

Dispatch the same brief to every seat at the same time, independently. Save every answer
verbatim, before anyone has seen anyone else's. If a seat fails (rate limit, timeout), retry
once after a short pause, then proceed without it and note the degradation rather than
silently continuing as if nothing happened.

## 3. Stage 2 — anonymized peer review (skip for 2-stage / routine councils)

1. Shuffle the answers and relabel them (Answer A, B, C…). Keep the mapping separate,
   never expose it to a reviewer.
2. Every reviewing seat sees the brief plus all anonymized answers, including its own, and
   returns: strengths, weaknesses/errors, a score, and a ranking. Every reviewer does this
   independently and in parallel.
3. Save each review.

## 4. Stage 3 — chairman synthesis

Someone (a strong model, or a human) sees the anonymized answers and, if this was a 3-stage
run, the reviews. They produce the final output by actively selecting and weighting, not by
blending everything into an average. For a genuinely contested question, they should also
produce a short account of where the seats agreed, where they split, and which way the
verdict went and why — that record is often as valuable as the final answer itself.

**One rule that matters more than it sounds like it should:** if every single reviewer
independently flags the same problem with the leading answer, that is not something to wave
through as "a known limitation." Something every seat agrees is a real issue, resolve it or
escalate it, don't just note it and move on.

## 5. Afterward

Log the run: which seats, what config, what the outcome was, and — once you know — whether
the humans accountable for the decision actually agreed with how it held up. This is what
turns "the council said so" into an improving, evidence-based practice instead of a ritual
you repeat on faith. See [`scorecard_schema.md`](scorecard_schema.md).
