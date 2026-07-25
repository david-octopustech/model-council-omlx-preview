# The council pattern — running several models on one hard question

A council is a small, structured way to get more than one AI model's opinion on a question,
and to combine their answers into something better than any single one, deliberately, not
just by averaging them together.

## When it's worth the extra cost

A council earns its cost on **judgment calls without a checkable answer** — the kind of
question where two informed, competent people could reasonably land in different places,
and there is no ground truth to check the answer against directly. Examples: a go/no-go
call under real uncertainty, a methodology critique, a piece of writing where "good" is a
judgment call, a strategic trade-off with no single right answer.

It is **not** worth it for questions with a checkable answer: a bug either is or isn't in
the code; a fact is either right or wrong. For those, one strong model plus a fresh,
independent check (a second pass that verifies the claim directly, not just re-reads the
same reasoning) is cheaper and just as reliable. Spending a council on a lookup problem
buys nothing but cost.

## The pattern: parallel answers, then synthesis, not averaging

The naive approach to combining several models is to blend their outputs, or have each
one see and build on the previous one's answer, layer by layer. Both are used in practice
and both share the same weakness: nothing in the process actively identifies and discounts
a bad answer. A weak or wrong contribution just gets folded into the average, quietly
pulling the result down.

The pattern that avoids this has three stages:

1. **Parallel, independent answers.** Every model gets the exact same brief, at the same
   time, with no visibility into what any other model is doing. This is what makes
   convergence meaningful: if models that never saw each other's work land on the same
   conclusion, that is real signal, not one model just following another's lead.

2. **Anonymized peer review (optional, for genuinely contested questions).** Every answer
   gets shuffled and relabeled before any reviewer sees it, including its own author. Each
   reviewing model scores every answer, blind to which model produced which. This step is
   what catches a plausible-sounding but wrong answer: a review pass has caught fabricated
   facts, blocking logical errors, and factual slips that the models' own self-review never
   would have surfaced, precisely because the reviewer has no idea whose answer it is
   grading, including possibly its own.

3. **Chairman synthesis.** One model (or a human) sees all the anonymized answers, and
   where relevant, the peer reviews, and actively selects and weights, rather than blending
   everything together. A synthesis step that can say "this answer is right and that one is
   wrong" behaves very differently from an averaging step that can only ever produce
   something in between. Excluding a bad answer entirely is possible here; blending it in
   at a lower weight is not.

Skip step 2 when the question doesn't need it (routine work, or something checkable where
direct verification does the same job for less).

## The two failure modes worth knowing

**Diluting a strong model with a weaker one is not free.** Adding an extra, weaker voice
"for diversity" can measurably pull a strong model's result down, not up, because there is
now a mediocre draft in the mix that the strong model has to be actively defended against
rather than simply outperforming alone. Composition matters more than headcount: a
consistent tier of models (several strong ones, or several genuinely capable cheaper ones)
tends to do well; mixing a strong model with a noticeably weaker one tends to do worse than
the strong model would have done by itself.

**A cheap, well-matched council can approach an expensive solo model's quality.** Several
lower-cost models, run in the same parallel-then-synthesize pattern, can land close to what
one high-end model produces alone. This is the more useful, durable finding of the two: it
says less about which specific model is "best" right now (that changes every few months)
and more about a structural property, tier consistency beats raw model prestige, that keeps
holding as new models replace old ones.

## One operational lesson worth carrying over

Give every model an explicit instruction to work only from the brief it was given: no
looking things up, no exploring files or tools, unless its job specifically requires that.
Without this, a model will sometimes go looking for context on its own, find something it
was not meant to see (the grading rubric, another seat's answer, background it should be
blind to), and quietly contaminate its own answer. An explicit "work only from this prompt"
instruction, stated up front, prevents this reliably. Leaving it implicit does not.

## What this buys you, in practice

The value of a council usually isn't "smarter individual thinking" from any single model.
It's coverage and explicitness: catching a gap one model would have skipped, forcing a
verdict where a single answer might have stayed vague, and surfacing genuine disagreement
instead of quietly smoothing it into one confident-sounding voice. A single model gives you
one answer, stated with total confidence regardless of how contested the question actually
is. A council, done this way, tells you where the real disagreement lives, and lets you see
whether it resolved for a good reason or just because one voice was loudest.
