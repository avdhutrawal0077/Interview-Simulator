"""
backend/services/llm.py
───────────────────────
Single, shared LLM client for the entire backend.

Uses google.genai (the only supported SDK) with model fallback chain
based on live model availability for this API key.

Model priority (newest/best → fastest fallback):
  gemini-3.8-flash → gemini-3.7-flash → gemini-3.6-flash →
  gemini-3.5-flash → gemini-flash-latest → gemini-flash-lite-latest
"""

from __future__ import annotations
import json
import logging
from typing import Any

logger = logging.getLogger("InterviewSimulator.LLM")

# Ordered list: best first, fastest-available last
_MODEL_CHAIN = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
]


def _get_client(api_key: str):
    from google import genai
    return genai.Client(api_key=api_key)


def generate_text(prompt: str, api_key: str) -> str:
    """
    Call Gemini for plain text generation.
    Tries models in _MODEL_CHAIN until one succeeds.
    Returns '' on total failure.
    """
    client = _get_client(api_key)
    for model in _MODEL_CHAIN:
        try:
            resp = client.models.generate_content(model=model, contents=prompt)
            if resp and resp.text:
                logger.debug(f"[LLM] text generation OK via {model}")
                return resp.text.strip()
        except Exception as e:
            err = str(e)
            # 503 = overloaded → try next; 404 = model gone → try next; 429 = quota → try next
            logger.debug(f"[LLM] {model} text failed: {err[:80]}")
            continue
    logger.error("[LLM] All models failed for text generation")
    return ""


def generate_json(prompt: str, api_key: str) -> dict[str, Any]:
    """
    Call Gemini for JSON-mode generation.
    Returns {} on total failure.
    """
    client = _get_client(api_key)
    for model in _MODEL_CHAIN:
        try:
            resp = client.models.generate_content(
                model=model,
                contents=prompt,
                config={"response_mime_type": "application/json"},
            )
            if resp and resp.text:
                text = resp.text.strip()
                # Strip markdown code fences if present
                if text.startswith("```"):
                    text = text.split("\n", 1)[-1]
                    text = text.rsplit("```", 1)[0]
                parsed = json.loads(text)
                logger.debug(f"[LLM] JSON generation OK via {model}")
                return parsed
        except json.JSONDecodeError as e:
            logger.warning(f"[LLM] {model} returned invalid JSON: {e}")
            continue
        except Exception as e:
            err = str(e)
            logger.debug(f"[LLM] {model} JSON failed: {err[:80]}")
            continue
    logger.error("[LLM] All models failed for JSON generation")
    return {}
