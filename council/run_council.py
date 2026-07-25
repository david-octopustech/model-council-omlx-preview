#!/usr/bin/env python3
"""
council.run_council — minimal orchestrator for the council pattern.

Wires together the three stages described in docs/pattern.md:

  1. Parallel dispatch — same brief to every seat, independently.
  2. Anonymized peer review (optional) — shuffle answers, blind review.
  3. Chairman synthesis — one model (or human) selects and weights.

This is a *generic* orchestrator: it takes a question and a list of callables
as input, not a hardcoded scenario. Any function with the signature
``(prompt: str) -> str`` works as a seat — the included ``bedrock_member.chat``
is one such callable, but you can wrap any API, local model, or mock.

CLI::

  python -m council.run_council --ask "your question here"
  python -m council.run_council --ask-file brief.md --seats nova-pro,nova-lite,deepseek-v3.2
  python -m council.run_council --ask "..." --seats nova-pro,nova-lite --no-review
"""
from __future__ import annotations

import argparse
import random
import string
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Callable

from council.bedrock_member import chat as bedrock_chat, MODELS

# Type alias: a seat is any callable that takes a prompt string and returns a string answer.
Seat = Callable[[str], str]


@dataclass
class CouncilResult:
    """Full record of a council run."""
    question: str
    answers: dict[str, str] = field(default_factory=dict)
    reviews: dict[str, dict] = field(default_factory=dict)
    synthesis: str = ""
    failed_seats: list[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [f"# Council Run\n\n**Question:** {self.question}\n"]
        if self.failed_seats:
            lines.append(f"**Failed seats:** {', '.join(self.failed_seats)}\n")
        lines.append("## Answers\n")
        for seat, answer in self.answers.items():
            lines.append(f"### {seat}\n\n{answer}\n")
        if self.reviews:
            lines.append("## Peer Reviews\n")
            for reviewer, review in self.reviews.items():
                lines.append(f"### {reviewer}\n\n{review}\n")
        lines.append("## Synthesis\n\n" + self.synthesis)
        return "\n".join(lines)


def _make_bedrock_seat(model: str, max_tokens: int = 2000) -> Seat:
    """Wrap a Bedrock model alias into a Seat callable."""
    def seat(prompt: str) -> str:
        result = bedrock_chat(prompt, model=model, max_tokens=max_tokens)
        return result.content
    seat.__name__ = model
    return seat


def _stage1_dispatch(seats: list[Seat], brief: str) -> dict[str, str]:
    """Stage 1: dispatch the same brief to every seat in parallel."""
    answers: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=len(seats)) as pool:
        futures = {pool.submit(seat, brief): seat for seat in seats}
        for future in as_completed(futures):
            seat = futures[future]
            name = getattr(seat, "__name__", str(seat))
            try:
                answers[name] = future.result()
            except Exception as e:
                print(f"  [warn] seat '{name}' failed: {e}", file=sys.stderr)
    return answers


def _anonymize(answers: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    """Shuffle answers and assign anonymous labels. Returns (anonymized, mapping)."""
    labels = list(string.ascii_uppercase)
    shuffled_keys = list(answers.keys())
    random.shuffle(shuffled_keys)
    anonymized = {}
    mapping = {}
    for key, label in zip(shuffled_keys, labels):
        anonymized[label] = answers[key]
        mapping[label] = key
    return anonymized, mapping


_REVIEW_PROMPT_TEMPLATE = """\
You are an anonymous peer reviewer in a council. You will see a question and several
anonymized answers (labeled A, B, C, ...). One of them may be your own — you must not
reveal which, and you must grade every answer on its merits.

For each answer, provide:
1. **Strengths** (1-2 sentences)
2. **Weaknesses or errors** (1-2 sentences)
3. **Score** (1-10, where 10 is excellent)

Then rank all answers from best to worst (e.g., B > A > C).

Work only from the brief and the answers below. Do not look anything up.

---

**Question:**
{question}

**Answers:**

{formatted_answers}
"""


def _stage2_review(
    reviewers: list[Seat],
    question: str,
    anonymized: dict[str, str],
) -> dict[str, str]:
    """Stage 2: each reviewer sees all anonymized answers and grades them."""
    formatted = "\n\n".join(
        f"### Answer {label}\n\n{text}" for label, text in sorted(anonymized.items())
    )
    review_prompt = _REVIEW_PROMPT_TEMPLATE.format(
        question=question, formatted_answers=formatted,
    )
    reviews: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=len(reviewers)) as pool:
        futures = {pool.submit(r, review_prompt): r for r in reviewers}
        for future in as_completed(futures):
            reviewer = futures[future]
            name = getattr(reviewer, "__name__", str(reviewer))
            try:
                reviews[name] = future.result()
            except Exception as e:
                print(f"  [warn] reviewer '{name}' failed: {e}", file=sys.stderr)
    return reviews


_SYNTHESIS_PROMPT_TEMPLATE = """\
You are the chairman of a council. Several models independently answered the same
question. You have their answers{review_clause}. Your job is to produce the best
possible final answer by actively selecting and weighting the strongest contributions,
not by blending everything into an average.

If answers disagree on something important, say so and explain which side you find
more convincing and why. Exclude weak or wrong contributions explicitly rather than
diluting strong ones by averaging them in.

Produce:
1. The final synthesized answer.
2. A short note on where the council agreed, where it split, and how you resolved it.

Work only from the material below. Do not look anything up.

---

**Question:**
{question}

**Answers:**

{formatted_answers}
{review_section}
"""


def _stage3_synthesize(
    chair: Seat,
    question: str,
    answers: dict[str, str],
    reviews: dict[str, str] | None = None,
) -> str:
    """Stage 3: the chair sees all answers (and reviews, if any) and synthesizes."""
    formatted = "\n\n".join(
        f"### {name}\n\n{text}" for name, text in answers.items()
    )
    review_section = ""
    review_clause = ""
    if reviews:
        review_clause = ", plus anonymized peer reviews"
        review_section = "\n**Peer Reviews:**\n\n" + "\n\n".join(
            f"### Reviewer: {name}\n\n{text}" for name, text in reviews.items()
        )
    synthesis_prompt = _SYNTHESIS_PROMPT_TEMPLATE.format(
        question=question,
        formatted_answers=formatted,
        review_section=review_section,
        review_clause=review_clause,
    )
    return chair(synthesis_prompt)


def run_council(
    question: str,
    seats: list[Seat],
    chair: Seat,
    reviewers: list[Seat] | None = None,
) -> CouncilResult:
    """Run a full council: dispatch → optional review → synthesize.

    Args:
        question: The question or brief to send to every seat.
        seats: List of callables, each taking a prompt and returning an answer.
        chair: A callable that synthesizes the final answer from all seats' work.
        reviewers: If provided, triggers Stage 2 (anonymized peer review).
            Each reviewer sees anonymized answers and returns structured reviews.

    Returns:
        A CouncilResult with all answers, reviews, synthesis, and any failed seats.
    """
    result = CouncilResult(question=question)

    print(f"[council] Stage 1: dispatching to {len(seats)} seat(s)...", file=sys.stderr)
    result.answers = _stage1_dispatch(seats, question)

    failed = [
        name for s in seats
        if (name := getattr(s, "__name__", str(s))) not in result.answers
    ]
    result.failed_seats = failed
    if failed:
        print(f"[council] Failed seats: {', '.join(failed)}", file=sys.stderr)

    reviews_dict = None
    if reviewers and len(result.answers) >= 2:
        print(f"[council] Stage 2: anonymized peer review with {len(reviewers)} reviewer(s)...", file=sys.stderr)
        anonymized, _mapping = _anonymize(result.answers)
        reviews_dict = _stage2_review(reviewers, question, anonymized)
        result.reviews = reviews_dict
    elif reviewers:
        print("[council] Stage 2: skipped (fewer than 2 answers succeeded)", file=sys.stderr)

    print("[council] Stage 3: chairman synthesis...", file=sys.stderr)
    result.synthesis = _stage3_synthesize(chair, question, result.answers, reviews_dict)

    print("[council] Done.", file=sys.stderr)
    return result


def _main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run a council on a question.")
    ap.add_argument("--ask", help="the question/task prompt")
    ap.add_argument("--ask-file", help="path to a file containing the prompt")
    ap.add_argument(
        "--seats",
        default="nova-pro,nova-lite",
        help="comma-separated model aliases (default: nova-pro,nova-lite)",
    )
    ap.add_argument(
        "--chair",
        default=None,
        help="model alias for the chairman (default: first seat)",
    )
    ap.add_argument(
        "--reviewers",
        default=None,
        help="comma-separated model aliases for peer reviewers (omit for 2-stage)",
    )
    ap.add_argument(
        "--no-review",
        action="store_true",
        help="explicitly skip peer review (2-stage council)",
    )
    ap.add_argument(
        "--max-tokens",
        type=int,
        default=2000,
        help="max tokens per seat (default: 2000)",
    )
    args = ap.parse_args(argv)

    if bool(args.ask) == bool(args.ask_file):
        ap.error("exactly one of --ask / --ask-file is required")
    question = args.ask
    if args.ask_file:
        from pathlib import Path
        question = Path(args.ask_file).read_text(encoding="utf-8")

    seat_names = [s.strip() for s in args.seats.split(",") if s.strip()]
    seats = [_make_bedrock_seat(name, max_tokens=args.max_tokens) for name in seat_names]

    chair_name = args.chair or seat_names[0]
    chair = _make_bedrock_seat(chair_name, max_tokens=args.max_tokens)

    reviewers = None
    if not args.no_review and args.reviewers:
        reviewer_names = [r.strip() for r in args.reviewers.split(",") if r.strip()]
        reviewers = [_make_bedrock_seat(name, max_tokens=args.max_tokens) for name in reviewer_names]

    result = run_council(question, seats, chair, reviewers=reviewers)
    print(result.summary())
    return 0


if __name__ == "__main__":
    sys.exit(_main())
