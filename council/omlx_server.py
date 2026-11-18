#!/usr/bin/env python3
"""Local web server for a three-seat oMLX model council.

The server keeps the browser local and proxies OpenAI-compatible requests to oMLX.
It deliberately does not persist prompts or model output on disk; the browser's
localStorage handles the user's draft and recent prompt history.
"""
from __future__ import annotations

import argparse
import binascii
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DEFAULT_OMLX_URL = "http://127.0.0.1:8000"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
MAX_BODY_BYTES = 12 * 1024 * 1024
MAX_QUESTION_CHARS = 20_000
MAX_IMAGE_BYTES = 8 * 1024 * 1024
DEFAULT_TIMEOUT_SECONDS = 180

REASONING_TAG = re.compile(r"<think\s*>(.*?)</think\s*>", re.IGNORECASE | re.DOTALL)
OPEN_REASONING_TAG = re.compile(r"<think\s*>", re.IGNORECASE)
CLOSE_REASONING_TAG = re.compile(r"</think\s*>", re.IGNORECASE)

SYSTEM_PROMPT = (
    "You are one independent seat in a local model council. Answer the user's "
    "question directly and rigorously. Do not refer to other seats, do not defer "
    "to an unseen consensus, and do not use tools or outside context. If the "
    "question is uncertain, state assumptions and uncertainty clearly."
)

REVIEW_SYSTEM_PROMPT = (
    "You are an anonymous peer reviewer in a local model council. Review every "
    "answer on its merits. You do not know which model wrote which answer, and "
    "you must not try to infer or reveal authorship. Work only from the brief and "
    "the anonymized answers provided."
)

SYNTHESIS_SYSTEM_PROMPT = (
    "You are the active chairman of a local model council. Select and weight the "
    "strongest evidence instead of averaging all answers together. You may reject "
    "a weak or incorrect answer. State meaningful agreement and disagreement, then "
    "give a clear final recommendation. Work only from the supplied brief, answers, "
    "and peer reviews; do not browse or use outside tools."
)


class CouncilError(RuntimeError):
    """An expected request or upstream failure that can be shown to the user."""


def _normalise_base_url(value: str | None) -> str:
    return (value or DEFAULT_OMLX_URL).rstrip("/")


def _auth_headers(api_key: str | None) -> dict[str, str]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _request_json(
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    api_key: str | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    data = None
    headers = _auth_headers(api_key)
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:800]
        raise CouncilError(f"oMLX returned HTTP {exc.code}: {detail}") from None
    except (urllib.error.URLError, TimeoutError) as exc:
        raise CouncilError(f"Could not reach oMLX at {url}: {exc}") from None
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        raise CouncilError("oMLX returned a non-JSON response") from None
    if not isinstance(parsed, dict):
        raise CouncilError("oMLX returned an unexpected JSON shape")
    return parsed


def list_models(base_url: str, api_key: str | None) -> list[dict[str, Any]]:
    """Return models advertised by oMLX, retaining metadata useful to the UI."""
    payload = _request_json(f"{_normalise_base_url(base_url)}/v1/models", api_key=api_key, timeout=15)
    models = payload.get("data", [])
    if not isinstance(models, list):
        raise CouncilError("oMLX /v1/models returned an invalid data list")
    normalised: list[dict[str, Any]] = []
    for item in models:
        if isinstance(item, str):
            normalised.append({"id": item, "model_type": "llm"})
            continue
        if not isinstance(item, dict) or not item.get("id"):
            continue
        model_type = item.get("model_type") or "llm"
        normalised.append(
            {
                "id": str(item["id"]),
                "model_type": model_type,
                "owned_by": item.get("owned_by", "omlx"),
                "max_model_len": item.get("max_model_len"),
                "max_context_window": item.get("max_context_window"),
            }
        )
    return normalised


def _extract_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        chunks: list[str] = []
        for part in value:
            if isinstance(part, str):
                chunks.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                chunks.append(part["text"])
        return "".join(chunks)
    return ""


def split_reasoning(text: str, explicit_reasoning: str = "") -> tuple[str, str]:
    """Extract oMLX/OpenAI reasoning fields and legacy inline ``<think>`` tags."""
    inline_parts = [match.group(1).strip() for match in REASONING_TAG.finditer(text)]
    answer = REASONING_TAG.sub("", text)
    open_match = OPEN_REASONING_TAG.search(answer)
    if open_match:
        close_match = CLOSE_REASONING_TAG.search(answer, open_match.end())
        if close_match:
            inline_parts.append(answer[open_match.end() : close_match.start()].strip())
            answer = answer[: open_match.start()] + answer[close_match.end() :]
        else:
            inline_parts.append(answer[open_match.end() :].strip())
            answer = answer[: open_match.start()]
    reasoning = "\n\n".join(part for part in [explicit_reasoning.strip(), *inline_parts] if part)
    return answer.strip(), reasoning


def _image_content(image: Any) -> dict[str, Any] | None:
    if not isinstance(image, dict):
        return None
    data_url = image.get("data_url")
    if not isinstance(data_url, str) or not data_url.startswith("data:"):
        raise CouncilError("image.data_url must be a data URL")
    header, separator, encoded = data_url.partition(",")
    if not separator or ";base64" not in header:
        raise CouncilError("image.data_url must contain base64-encoded image data")
    try:
        decoded = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise CouncilError("image.data_url contains invalid base64") from None
    if len(decoded) > MAX_IMAGE_BYTES:
        raise CouncilError("image is larger than the 8 MB local limit")
    mime = header[5:].split(";", 1)[0] or "application/octet-stream"
    if not mime.startswith("image/"):
        raise CouncilError("only image data URLs are supported")
    return {"type": "image_url", "image_url": {"url": data_url, "detail": "auto"}}


def build_chat_payload(
    question: str,
    model: str,
    *,
    thinking: bool = True,
    thinking_budget: int | None = 2048,
    max_tokens: int = 2500,
    temperature: float = 0.7,
    image: Any = None,
    system_prompt: str = SYSTEM_PROMPT,
) -> dict[str, Any]:
    """Build one OpenAI-compatible request for an oMLX seat."""
    user_content: str | list[dict[str, Any]] = question
    image_part = _image_content(image)
    if image_part:
        user_content = [{"type": "text", "text": question}, image_part]
    payload: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "stream": False,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "enable_thinking": thinking,
    }
    if thinking_budget is not None:
        payload["thinking_budget"] = thinking_budget if thinking else 0
    return payload


def _normalise_result(model: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        choice = payload["choices"][0]
        message = choice.get("message", {})
    except (KeyError, IndexError, TypeError):
        raise CouncilError("oMLX returned no chat completion choice") from None
    if not isinstance(message, dict):
        raise CouncilError("oMLX returned an invalid assistant message")
    content = _extract_text(message.get("content", ""))
    explicit_reasoning = _extract_text(
        message.get("reasoning_content") or message.get("reasoning") or ""
    )
    answer, reasoning = split_reasoning(content, explicit_reasoning)
    usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
    detail_keys = (
        "finish_reason",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "model_load_duration",
        "time_to_first_token",
        "total_time",
        "prompt_tokens_per_second",
        "generation_tokens_per_second",
    )
    details: dict[str, Any] = {key: usage[key] for key in detail_keys if key in usage}
    if "finish_reason" in choice:
        details["finish_reason"] = choice["finish_reason"]
    return {
        "model": model,
        "status": "ok",
        "answer": answer,
        "thinking": reasoning,
        "details": details,
    }


def _call_seat(
    model: str,
    question: str,
    *,
    base_url: str,
    api_key: str | None,
    thinking: bool,
    thinking_budget: int | None,
    max_tokens: int,
    temperature: float,
    image: Any,
    system_prompt: str = SYSTEM_PROMPT,
) -> dict[str, Any]:
    try:
        response = _request_json(
            f"{_normalise_base_url(base_url)}/v1/chat/completions",
            payload=build_chat_payload(
                question,
                model,
                thinking=thinking,
                thinking_budget=thinking_budget,
                max_tokens=max_tokens,
                temperature=temperature,
                image=image,
                system_prompt=system_prompt,
            ),
            api_key=api_key,
        )
        return _normalise_result(model, response)
    except CouncilError as exc:
        return {"model": model, "status": "error", "answer": "", "thinking": "", "details": {}, "error": str(exc)}
    except Exception as exc:  # defensive boundary for one seat
        return {
            "model": model,
            "status": "error",
            "answer": "",
            "thinking": "",
            "details": {},
            "error": f"Unexpected seat error: {exc}",
        }


def _call_prompt(
    model: str,
    prompt: str,
    *,
    base_url: str,
    api_key: str | None,
    thinking: bool,
    thinking_budget: int | None,
    max_tokens: int,
    temperature: float,
    system_prompt: str,
) -> dict[str, Any]:
    """Call a model with a council-stage prompt and normalize the result."""
    try:
        response = _request_json(
            f"{_normalise_base_url(base_url)}/v1/chat/completions",
            payload=build_chat_payload(
                prompt,
                model,
                thinking=thinking,
                thinking_budget=thinking_budget,
                max_tokens=max_tokens,
                temperature=temperature,
                system_prompt=system_prompt,
            ),
            api_key=api_key,
        )
        return _normalise_result(model, response)
    except CouncilError as exc:
        return {"model": model, "status": "error", "answer": "", "thinking": "", "details": {}, "error": str(exc)}
    except Exception as exc:  # defensive boundary for one reviewer/chair
        return {
            "model": model,
            "status": "error",
            "answer": "",
            "thinking": "",
            "details": {},
            "error": f"Unexpected model error: {exc}",
        }


def run_local_council(request: dict[str, Any], *, base_url: str, api_key: str | None) -> dict[str, Any]:
    question = request.get("question")
    models = request.get("models")
    if not isinstance(question, str) or not question.strip():
        raise CouncilError("question is required")
    question = question.strip()
    if len(question) > MAX_QUESTION_CHARS:
        raise CouncilError(f"question exceeds the {MAX_QUESTION_CHARS:,}-character limit")
    if not isinstance(models, list) or len(models) != 3 or any(not isinstance(model, str) or not model.strip() for model in models):
        raise CouncilError("exactly three model IDs are required")
    if len(set(models)) != 3:
        raise CouncilError("choose three distinct model IDs")
    thinking, thinking_budget, max_tokens, temperature = _model_parameters(
        request,
        default_max_tokens=2500,
        default_temperature=0.7,
    )
    image = request.get("image")
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [
            pool.submit(
                _call_seat,
                model.strip(),
                question,
                base_url=base_url,
                api_key=api_key,
                thinking=thinking,
                thinking_budget=thinking_budget,
                max_tokens=max_tokens,
                temperature=temperature,
                image=image,
            )
            for model in models
        ]
        results = [future.result() for future in futures]
    return {
        "stage": "dispatch",
        "question": question,
        "thinking": thinking,
        "results": results,
    }


def _clean_answer_packet(answers: Any) -> list[dict[str, str]]:
    if not isinstance(answers, list) or len(answers) < 2:
        raise CouncilError("at least two answers are required")
    cleaned: list[dict[str, str]] = []
    for item in answers:
        if not isinstance(item, dict):
            continue
        answer = item.get("answer") or item.get("text")
        if isinstance(answer, str) and answer.strip():
            cleaned.append({"answer": answer.strip()})
    if len(cleaned) < 2:
        raise CouncilError("at least two non-empty answers are required")
    return cleaned


def _anonymous_answers(answers: list[dict[str, str]]) -> list[dict[str, str]]:
    import random

    shuffled = list(answers)
    random.SystemRandom().shuffle(shuffled)
    return [
        {"label": chr(ord("A") + index), "answer": item["answer"]}
        for index, item in enumerate(shuffled)
    ]


def _validate_stage_question(request: dict[str, Any]) -> str:
    question = request.get("question")
    if not isinstance(question, str) or not question.strip():
        raise CouncilError("question is required")
    if len(question.strip()) > MAX_QUESTION_CHARS:
        raise CouncilError(f"question exceeds the {MAX_QUESTION_CHARS:,}-character limit")
    return question.strip()


def _model_parameters(
    request: dict[str, Any],
    *,
    default_max_tokens: int,
    default_temperature: float,
) -> tuple[bool, int | None, int, float]:
    try:
        thinking = bool(request.get("thinking", True))
        budget_value = request.get("thinking_budget", 2048)
        thinking_budget = int(budget_value) if budget_value is not None else None
        max_tokens = int(request.get("max_tokens", default_max_tokens))
        temperature = float(request.get("temperature", default_temperature))
    except (TypeError, ValueError):
        raise CouncilError("thinking_budget, max_tokens, and temperature must be numeric") from None
    if thinking_budget is not None:
        thinking_budget = max(0, min(thinking_budget, 16_000))
    max_tokens = max(128, min(max_tokens, 16_000))
    temperature = max(0.0, min(temperature, 2.0))
    return thinking, thinking_budget, max_tokens, temperature


def run_anonymized_review(request: dict[str, Any], *, base_url: str, api_key: str | None) -> dict[str, Any]:
    """Run optional blind review without exposing the model-to-label mapping."""
    question = _validate_stage_question(request)
    anonymous = _anonymous_answers(_clean_answer_packet(request.get("answers")))
    reviewers = request.get("reviewers")
    if not isinstance(reviewers, list) or len(reviewers) != 2 or any(not isinstance(item, str) or not item.strip() for item in reviewers):
        raise CouncilError("exactly two distinct reviewer model IDs are required")
    reviewers = [item.strip() for item in reviewers]
    if len(set(reviewers)) != 2:
        raise CouncilError("reviewer seats must use two distinct model IDs")
    formatted = "\n\n".join(f"### Answer {item['label']}\n\n{item['answer']}" for item in anonymous)
    prompt = f"""Review the following council answers anonymously.\n\nFor every answer, provide:\n1. Strengths.\n2. Weaknesses, omissions, or errors.\n3. A score from 1 to 10.\n\nFinish with a ranking from best to worst, for example: B > A > C. Be specific and fair.\n\nQUESTION:\n{question}\n\nANONYMIZED ANSWERS:\n{formatted}"""
    thinking, thinking_budget, max_tokens, temperature = _model_parameters(
        request,
        default_max_tokens=1800,
        default_temperature=0.4,
    )
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [
            pool.submit(
                _call_prompt,
                reviewer,
                prompt,
                base_url=base_url,
                api_key=api_key,
                thinking=thinking,
                thinking_budget=thinking_budget,
                max_tokens=max_tokens,
                temperature=temperature,
                system_prompt=REVIEW_SYSTEM_PROMPT,
            )
            for reviewer in reviewers
        ]
        reviews = [future.result() for future in futures]
    return {
        "stage": "review",
        "question": question,
        "anonymous_answers": anonymous,
        "reviews": reviews,
    }


def run_active_synthesis(request: dict[str, Any], *, base_url: str, api_key: str | None) -> dict[str, Any]:
    """Ask one chairman to actively select from a blind answer/review packet."""
    question = _validate_stage_question(request)
    anonymous = request.get("anonymous_answers")
    if isinstance(anonymous, list) and anonymous:
        packets = []
        for item in anonymous:
            if isinstance(item, dict) and isinstance(item.get("label"), str) and isinstance(item.get("answer"), str):
                packets.append({"label": item["label"], "answer": item["answer"]})
        if len(packets) < 2:
            raise CouncilError("at least two anonymous answers are required")
    else:
        packets = _anonymous_answers(_clean_answer_packet(request.get("answers")))
    chair = request.get("chair")
    if not isinstance(chair, str) or not chair.strip():
        raise CouncilError("a chairman model ID is required")
    reviews = request.get("reviews")
    review_text = ""
    if isinstance(reviews, list) and reviews:
        review_text = "\n\nPEER REVIEWS:\n" + "\n\n".join(
            f"### Reviewer {index + 1}\n\n{item.get('answer', '')}"
            for index, item in enumerate(reviews)
            if isinstance(item, dict)
        )
    answer_text = "\n\n".join(f"### Answer {item['label']}\n\n{item['answer']}" for item in packets)
    prompt = f"""Act as the active chairman for this council. Select and weight the strongest answer; do not average all answers into a vague compromise. Reject errors explicitly.\n\nReturn:\n1. A clear final answer or recommendation.\n2. A short council readout: where the answers agreed, where they disagreed, and why you resolved the disagreement as you did.\n\nQUESTION:\n{question}\n\nANONYMIZED ANSWERS:\n{answer_text}{review_text}"""
    thinking, thinking_budget, max_tokens, temperature = _model_parameters(
        request,
        default_max_tokens=2500,
        default_temperature=0.4,
    )
    result = _call_prompt(
        chair.strip(),
        prompt,
        base_url=base_url,
        api_key=api_key,
        thinking=thinking,
        thinking_budget=thinking_budget,
        max_tokens=max_tokens,
        temperature=temperature,
        system_prompt=SYNTHESIS_SYSTEM_PROMPT,
    )
    return {"stage": "synthesis", "question": question, "chair": chair.strip(), "synthesis": result}


class CouncilHandler(BaseHTTPRequestHandler):
    server_version = "LocalCouncil/1.0"

    @property
    def configured_server(self) -> "CouncilHTTPServer":
        return self.server  # type: ignore[return-value]

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise CouncilError("invalid Content-Length") from None
        if length <= 0 or length > MAX_BODY_BYTES:
            raise CouncilError("request body is empty or larger than the local limit")
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise CouncilError("request body must be valid JSON") from None
        if not isinstance(payload, dict):
            raise CouncilError("request body must be a JSON object")
        return payload

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/api/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "omlx_url": self.configured_server.omlx_url})
            return
        if self.path == "/api/models":
            try:
                models = list_models(self.configured_server.omlx_url, self.configured_server.api_key)
                self._send_json(HTTPStatus.OK, {"data": models})
            except CouncilError as exc:
                self._send_json(HTTPStatus.BAD_GATEWAY, {"error": str(exc), "data": []})
            return
        self._serve_static()

    def _serve_static(self) -> None:
        relative = self.path.split("?", 1)[0].lstrip("/") or "index.html"
        candidate = (WEB_DIR / relative).resolve()
        try:
            candidate.relative_to(WEB_DIR.resolve())
        except ValueError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not candidate.is_file():
            candidate = WEB_DIR / "index.html"
        try:
            data = candidate.read_bytes()
        except OSError:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in {"/api/council", "/api/council/review", "/api/council/synthesize"}:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        try:
            payload = self._read_json()
            if self.path == "/api/council/review":
                result = run_anonymized_review(
                    payload,
                    base_url=self.configured_server.omlx_url,
                    api_key=self.configured_server.api_key,
                )
            elif self.path == "/api/council/synthesize":
                result = run_active_synthesis(
                    payload,
                    base_url=self.configured_server.omlx_url,
                    api_key=self.configured_server.api_key,
                )
            else:
                result = run_local_council(
                    payload,
                    base_url=self.configured_server.omlx_url,
                    api_key=self.configured_server.api_key,
                )
            self._send_json(HTTPStatus.OK, result)
        except CouncilError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})

    def log_message(self, _format: str, *_args: Any) -> None:
        return


class CouncilHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True

    def __init__(self, address: tuple[str, int], omlx_url: str, api_key: str | None):
        super().__init__(address, CouncilHandler)
        self.omlx_url = _normalise_base_url(omlx_url)
        self.api_key = api_key


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Serve the local oMLX model council UI.")
    parser.add_argument("--host", default=os.getenv("COUNCIL_HOST", DEFAULT_HOST))
    parser.add_argument("--port", type=int, default=int(os.getenv("COUNCIL_PORT", DEFAULT_PORT)))
    parser.add_argument("--omlx-url", default=os.getenv("OMLX_BASE_URL", DEFAULT_OMLX_URL))
    parser.add_argument("--api-key", default=os.getenv("OMLX_API_KEY"))
    args = parser.parse_args(argv)
    server = CouncilHTTPServer((args.host, args.port), args.omlx_url, args.api_key)
    print(f"Local council: http://{args.host}:{args.port}")
    print(f"oMLX upstream: {server.omlx_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local council.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
