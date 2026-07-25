#!/usr/bin/env python3
"""
council.bedrock_member — call an AWS Bedrock model as a council seat.

Uses the Converse API (uniform request/response shape through Amazon/DeepSeek/Meta,
unlike raw InvokeModel which has a provider-specific body format). Auth is a named
boto3 profile (never an inline key) — set one up via ``aws configure --profile <name>``
scoped to an IAM user/role with invoke-only Bedrock permissions.

Candidate models (serverless in us-east-1; verify current IDs via list_foundation_models,
they rotate as providers ship new versions)::

  nova-pro          amazon.nova-pro-v1:0                       direct invoke
  nova-lite         amazon.nova-lite-v1:0                      direct invoke, cheap tier
  nova2-lite        amazon.nova-2-lite-v1:0                    direct invoke, newer cheap tier
  deepseek-v3.2     deepseek.v3.2                              reasoning model
  llama4-maverick   us.meta.llama4-maverick-17b-instruct-v1:0  cross-region inference profile
  llama4-scout      us.meta.llama4-scout-17b-instruct-v1:0     cross-region inference profile
  devstral          mistral.devstral-2-123b                    direct invoke, code-specialized
  gpt-oss-120b      openai.gpt-oss-120b-1:0                    direct invoke, reasoning model
  qwen3-coder       qwen.qwen3-coder-next                      direct invoke, code-specialized
  kimi-k2           moonshot.kimi-k2-thinking                  direct invoke, reasoning model
  kimi-k2.5         moonshotai.kimi-k2.5                       direct invoke, reasoning (frontier)

Bedrock's non-Anthropic catalog is much wider than this list (AI21, Cohere, Google Gemma,
Mistral, Moonshot, NVIDIA, OpenAI, Qwen, Z.AI/GLM, ...) — pick candidates against a real gap
in your own roster's evidence, not preemptively. Anthropic models are available via Bedrock
too but usually redundant if you already have native Claude access some other way.

deepseek-v3.2, gpt-oss-120b, kimi-k2 and kimi-k2.5 are reasoning models: Converse returns
their chain-of-thought as a separate ``reasoningContent`` block ahead of the text block,
parsed here into ChatResult.reasoning.

CLI::

  python -m council.bedrock_member --ask "explain this regex: ^(?=.*\\d).{8,}$"
  python -m council.bedrock_member --ask "..." --model deepseek-v3.2 --show-thinking
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from dataclasses import dataclass, field

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

PROFILE = "council-bedrock"
REGION = "us-east-1"
DEFAULT_MODEL = "nova-pro"

MODELS = {
    "nova-pro": "amazon.nova-pro-v1:0",
    "nova-lite": "amazon.nova-lite-v1:0",
    # nova2-lite: MUST use the us. inference profile (on-demand direct isn't supported).
    # Avoid global.* profiles if data residency in a specific region matters to you.
    "nova2-lite": "us.amazon.nova-2-lite-v1:0",
    "deepseek-v3.2": "deepseek.v3.2",
    "llama4-maverick": "us.meta.llama4-maverick-17b-instruct-v1:0",
    "llama4-scout": "us.meta.llama4-scout-17b-instruct-v1:0",
    "devstral": "mistral.devstral-2-123b",
    "gpt-oss-120b": "openai.gpt-oss-120b-1:0",
    "qwen3-coder": "qwen.qwen3-coder-next",
    "kimi-k2": "moonshot.kimi-k2-thinking",
    "kimi-k2.5": "moonshotai.kimi-k2.5",
}

# Reasoning models spend tokens on chain-of-thought before the final answer (often
# hundreds just for a one-line question) -> the flat default must be higher or the
# answer comes back empty with the whole budget burned on reasoning. Confirmed via
# smoke test (gpt-oss-120b returned empty content at max_tokens=20). deepseek-v3.2,
# kimi-k2 and kimi-k2.5 are all reasoning models too. These floors only prevent empty
# one-liners on trivial prompts — a real task brief needs a much higher explicit budget,
# set that at the call site rather than relying on this default.
MODEL_DEFAULT_MAX_TOKENS = {
    "deepseek-v3.2": 2500, "gpt-oss-120b": 2500, "kimi-k2": 2500, "kimi-k2.5": 2500,
}

# Throttling is transient (shared serverless capacity) -> retry with backoff. Other
# ClientErrors (access denied, bad model id, validation) are permanent -> fail fast.
RETRYABLE_ERRORS = {
    "ThrottlingException", "ModelTimeoutException", "ServiceUnavailableException",
    "ModelNotReadyException", "InternalServerException",
}


@dataclass
class ChatResult:
    content: str
    reasoning: str = ""
    model: str = ""
    usage: dict = field(default_factory=dict)
    raw: dict = field(default_factory=dict)

    def __str__(self) -> str:
        return self.content


def _fix_console() -> None:
    """Bedrock answers can contain smart quotes/em-dashes; force UTF-8 so they don't
    get mangled (mojibake) on a cp1252 Windows console."""
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def _client(timeout: int = 120):
    session = boto3.Session(profile_name=PROFILE, region_name=REGION)
    config = Config(read_timeout=timeout, connect_timeout=min(timeout, 10))
    return session.client("bedrock-runtime", config=config)


def _strip_code_fence(text: str) -> str:
    """Some models (seen with deepseek-r1) wrap the whole markdown answer in a
    ```markdown ... ``` fence despite being asked for raw markdown. If the entire
    response is exactly one fenced block, unwrap it."""
    lines = text.split("\n")
    if len(lines) >= 2 and lines[0].strip().startswith("```") and lines[-1].strip() == "```":
        return "\n".join(lines[1:-1]).strip()
    return text


def chat(prompt, model: str = DEFAULT_MODEL, system: str | None = None,
         max_tokens: int | None = None, temperature: float | None = None,
         retries: int = 4, timeout: int = 120) -> ChatResult:
    """Send a prompt (str) or full Converse ``messages`` (list) to a Bedrock model."""
    model_id = MODELS.get(model, model)  # allow passing a raw model/profile id directly
    if max_tokens is None:
        # look up by alias first, then by resolved id, so a raw model id (e.g. passed
        # directly instead of via its alias) still gets a reasoning model's higher default.
        max_tokens = MODEL_DEFAULT_MAX_TOKENS.get(model) or MODEL_DEFAULT_MAX_TOKENS.get(model_id, 1500)

    if isinstance(prompt, str):
        messages = [{"role": "user", "content": [{"text": prompt}]}]
    else:
        messages = prompt

    kwargs: dict = {
        "modelId": model_id,
        "messages": messages,
        "inferenceConfig": {"maxTokens": max_tokens},
    }
    if system:
        kwargs["system"] = [{"text": system}]
    if temperature is not None:
        kwargs["inferenceConfig"]["temperature"] = temperature

    client = _client(timeout)
    last_error: Exception | None = None
    resp = None
    for attempt in range(1, retries + 1):
        try:
            resp = client.converse(**kwargs)
            break
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in RETRYABLE_ERRORS and attempt < retries:
                last_error = e
                time.sleep(min(20, 2 ** attempt + random.uniform(0, 1)))
                continue
            raise RuntimeError(f"Bedrock {code}: {e.response.get('Error', {}).get('Message')}") from None
        except BotoCoreError as e:
            # read/connect timeouts and connectivity errors aren't ClientErrors —
            # they carry no Error.Code, but are just as transient. Retry the same way.
            if attempt < retries:
                last_error = e
                time.sleep(min(20, 2 ** attempt + random.uniform(0, 1)))
                continue
            raise RuntimeError(f"Bedrock connection error after {attempt} tries: {e}") from None
    if resp is None:
        raise RuntimeError(f"Bedrock call failed after {retries} tries: {last_error}")

    blocks = resp["output"]["message"]["content"]
    text = "".join(b["text"] for b in blocks if "text" in b).strip()
    text = _strip_code_fence(text)
    reasoning = "".join(
        b.get("reasoningContent", {}).get("reasoningText", {}).get("text", "")
        for b in blocks if "reasoningContent" in b
    ).strip()

    return ChatResult(
        content=text,
        reasoning=reasoning,
        model=model_id,
        usage=resp.get("usage", {}),
        raw=resp,
    )


def _main(argv: list[str] | None = None) -> int:
    _fix_console()
    ap = argparse.ArgumentParser(description="Call a Bedrock model (council seat).")
    ap.add_argument("--ask", help="a question/task prompt")
    ap.add_argument("--ask-file", help="path to a file containing the prompt (for long briefs — avoids the Windows argv length limit)")
    ap.add_argument("--model", default=DEFAULT_MODEL, choices=list(MODELS))
    ap.add_argument("--system", help="optional system prompt")
    ap.add_argument("--max-tokens", type=int, default=None, help="default: 1500, or 2500 for reasoning models")
    ap.add_argument("--temperature", type=float)
    ap.add_argument("--show-thinking", action="store_true",
                     help="also print reasoning trace (reasoning models: deepseek-v3.2, kimi-k2/k2.5, gpt-oss-120b)")
    args = ap.parse_args(argv)

    if bool(args.ask) == bool(args.ask_file):
        ap.error("exactly one of --ask / --ask-file is required")
    prompt = args.ask
    if args.ask_file:
        from pathlib import Path
        prompt = Path(args.ask_file).read_text(encoding="utf-8")

    try:
        res = chat(prompt, model=args.model, system=args.system,
                   max_tokens=args.max_tokens, temperature=args.temperature)
    except RuntimeError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1

    if args.show_thinking and res.reasoning:
        print("=== thinking ===\n" + res.reasoning + "\n=== answer ===")
    print(res.content if res.content else "(empty content — try a higher --max-tokens)")
    u = res.usage
    print(f"\n[{res.model}] tokens: in={u.get('inputTokens')} out={u.get('outputTokens')} "
          f"total={u.get('totalTokens')}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(_main())
