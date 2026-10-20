"""
backend/routers/transcribe.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Local Streaming STT WebSocket Router — Phase 3
Replaces the legacy Gemini-based transcription endpoint.

Protocol:
  Client → Server:
    binary: raw PCM16LE mono 16 kHz frames (512 samples / 1024 bytes / 32 ms)
    JSON {"type": "start",    "sampleRate": 16000}
    JSON {"type": "finalize"}   — explicit utterance flush
    JSON {"type": "ping"}       — keep-alive
    JSON {"type": "stop"}       — end of interview

  Server → Client:
    JSON {"type": "ready",   "resume_from_ms": <int>}
    JSON {"type": "loading"}                          — model not ready yet
    JSON {"type": "interim", "text": <str>, "seq": <int>}
    JSON {"type": "final",   "text": <str>, "seq": <int>, "audio_end_ms": <int>}
    JSON {"type": "pong"}
    JSON {"type": "error",   "code": <str>, "message": <str>, "retryable": <bool>}
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections import deque
from typing import Optional

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.services.stt_service import STTService
from backend.services.name_corrector import build_corrector
from backend.database import session_store

logger = logging.getLogger("InterviewSimulator.Transcribe")
router = APIRouter(tags=["Transcription"])

# ─── Constants ────────────────────────────────────────────────────────────────
_SAMPLE_RATE = 16000          # Hz
_FRAME_SAMPLES = 512          # 32 ms @ 16 kHz
_FRAME_BYTES = _FRAME_SAMPLES * 2   # PCM16 = 2 bytes/sample

_VAD_SPEECH_THRESHOLD = 0.65  # Silero probability to treat as speech (raised: 0.50→0.65 to reject background noise)
_VAD_SILENCE_THRESHOLD = 0.45 # Below this → silence (raised: 0.35→0.45 for consistent hysteresis)

# Pre-roll: keep N frames before speech onset to avoid clipping leading phonemes
_PREROLL_FRAMES = 10          # 10 × 32 ms = 320 ms

# Hard cap: force intermediate final after this many ms of continuous speech
_MAX_UTTERANCE_MS = 30_000

# Max per-session audio buffer size (bytes) — safety ceiling
_MAX_SESSION_BUFFER = 10 * 1024 * 1024   # 10 MB

# Interim preview every N ms (only triggered while speech is active)
_INTERIM_INTERVAL_MS = int(os.getenv("STT_INTERIM_INTERVAL_MS", "200"))  # 5 updates/sec

# Silence endpoint: STT_ENDPOINT_SILENCE_MS env var (default 450 ms)
_SILENCE_MS = int(os.getenv("STT_ENDPOINT_SILENCE_MS", "450"))

# ─── Session state ────────────────────────────────────────────────────────────

class _SessionState:
    """
    Per-connection mutable state for one WebSocket session.
    Holds the VAD state machine, audio buffers, and sequence counter.
    """
    __slots__ = (
        "seq",
        "received_ms",
        "utterance_buf",
        "preroll",
        "in_speech",
        "speech_start_ms",
        "last_silence_ms",
        "total_buf_bytes",
        "last_interim_ms",
        "pending_final",
        "pending_interim",
    )

    def __init__(self) -> None:
        self.seq: int = 0
        self.received_ms: int = 0         # monotonically increasing audio time
        self.utterance_buf = bytearray()  # accumulates current utterance PCM
        self.preroll: deque = deque(maxlen=_PREROLL_FRAMES)  # ring of (bytes,) tuples
        self.in_speech: bool = False
        self.speech_start_ms: int = 0
        self.last_silence_ms: int = 0
        self.total_buf_bytes: int = 0     # safety counter
        self.last_interim_ms: int = 0
        self.pending_final: bool = False  # prevents overlapping final tasks
        self.pending_interim: bool = False

    def reset_utterance(self) -> None:
        self.utterance_buf = bytearray()
        self.in_speech = False
        self.speech_start_ms = 0
        self.last_silence_ms = 0
        self.last_interim_ms = 0
        self.pending_final = False
        self.pending_interim = False


# ─── WebSocket endpoint ───────────────────────────────────────────────────────

@router.websocket("/ws/transcribe/{session_id}")
@router.websocket("/ws/transcribe")
async def websocket_transcribe(
    websocket: WebSocket,
    session_id: Optional[str] = "default",
) -> None:
    """
    Streaming PCM16LE → local Whisper transcription via Silero VAD endpointing.
    """
    await websocket.accept()
    logger.info(f"[STT] Client connected: session_id={session_id}")

    stt = STTService.instance()
    state = _SessionState()

    # ── Build per-session initial prompt for better name/term accuracy ─────
    # IMPORTANT: Whisper's `initial_prompt` is treated as prior speech context,
    # NOT as metadata. Biographical sentences like "My name is X" or
    # "I am interviewing for Y" will be hallucinated verbatim into the transcript
    # (especially on silence or quiet audio). Use ONLY technical vocabulary
    # keywords so Whisper learns domain spelling without echoing full sentences.
    session_initial_prompt: str | None = None
    if session_id and session_id != "default":
        sess = session_store.get_session(session_id)
        if sess:
            role = sess.get("role", "").strip()
            # Build a vocabulary-only prompt: role title + generic domain terms.
            # No full sentences — prevents Whisper from repeating them.
            role_terms = role if role else ""
            base_terms = (
                "software engineering, algorithms, Python, React, system design, "
                "databases, cloud architecture, machine learning, API, microservices"
            )
            combined = f"{role_terms}, {base_terms}" if role_terms else base_terms
            session_initial_prompt = combined
            logger.info(f"[STT] Session vocabulary prompt set for role='{role}'")

    # ── Build per-session proper-noun corrector from resume data ────────────
    # This corrects Whisper mishearings of the candidate's name, college,
    # employer names etc. using phonetic + fuzzy matching — no extra inference.
    _sess_for_corrector = (
        session_store.get_session(session_id)
        if session_id and session_id != "default" else None
    )
    name_corrector = build_corrector(_sess_for_corrector)

    # ── Reset VAD LSTM state so prior-session residuals don't trigger false speech onset ──
    stt.reset_vad()

    # ── Handshake ──────────────────────────────────────────────────────────
    if not stt.is_ready:
        if stt.is_loading:
            await websocket.send_json({"type": "loading"})
            # Wait (up to 60 s) for model to finish loading
            for _ in range(120):
                await asyncio.sleep(0.5)
                if stt.is_ready:
                    break
            if not stt.is_ready:
                await websocket.send_json({
                    "type": "error",
                    "code": "model_timeout",
                    "message": "STT model failed to load within 60 s.",
                    "retryable": True,
                })
                return
        else:
            # Model hasn't been triggered to load yet — do it now
            try:
                await stt.load()
            except Exception as exc:
                await websocket.send_json({
                    "type": "error",
                    "code": "model_load_error",
                    "message": str(exc),
                    "retryable": False,
                })
                return

    await websocket.send_json({"type": "ready", "resume_from_ms": state.received_ms})

    # ── Inner helpers (closures over `state` and `websocket`) ──────────────

    async def _emit_final(pcm_bytes: bytes) -> None:
        """Transcribe a complete utterance and emit final result."""
        nonlocal state
        if len(pcm_bytes) < 3200:     # < 100 ms — too short, likely noise
            state.pending_final = False
            return
        seq = state.seq
        audio_end_ms = state.received_ms
        try:
            text = await stt.transcribe_final(pcm_bytes, initial_prompt=session_initial_prompt)
            if text:
                text = name_corrector.correct(text)  # fix proper-noun mishearings
            if text:
                state.seq += 1
                await websocket.send_json({
                    "type": "final",
                    "text": text,
                    "seq": seq,
                    "audio_end_ms": audio_end_ms,
                })
        except Exception as exc:
            logger.debug(f"[STT] Final emit error: {exc}")
        finally:
            state.pending_final = False

    async def _emit_interim(pcm_bytes: bytes) -> None:
        """Quick beam-1 transcription for live text preview."""
        nonlocal state
        try:
            text = await stt.transcribe_interim(pcm_bytes, initial_prompt=session_initial_prompt)
            if text:
                text = name_corrector.correct(text)  # fix proper-noun mishearings
            if text:
                await websocket.send_json({
                    "type": "interim",
                    "text": text,
                    "seq": state.seq,
                })
        except Exception as exc:
            logger.debug(f"[STT] Interim emit error: {exc}")
        finally:
            state.pending_interim = False

    def _maybe_flush_final() -> None:
        """
        Snapshot the utterance buffer and schedule a final transcription task.
        Resets the utterance state immediately so new audio accumulates cleanly.
        """
        if state.pending_final:
            return
        data = bytes(state.utterance_buf)
        state.reset_utterance()
        if len(data) >= 3200:
            state.pending_final = True
            asyncio.create_task(_emit_final(data))

    def _process_vad_frame(frame: bytes) -> None:
        """
        Run Silero VAD on one 32 ms frame and update the state machine.
        This is intentionally synchronous — Silero ONNX runs in microseconds.
        """
        now_ms = state.received_ms  # already advanced before call
        prob = stt.vad_score(frame)

        if prob >= _VAD_SPEECH_THRESHOLD:
            if not state.in_speech:
                # ── Speech onset ─────────────────────────────────────────
                state.in_speech = True
                state.speech_start_ms = now_ms
                # Prepend pre-roll frames so leading phonemes aren't lost
                for pf in state.preroll:
                    state.utterance_buf.extend(pf)
            state.utterance_buf.extend(frame)
            state.last_silence_ms = 0

            # Hard cap: force intermediate final after 30 s of speech
            if (now_ms - state.speech_start_ms) >= _MAX_UTTERANCE_MS:
                logger.info("[STT] 30 s hard cap reached — flushing intermediate final.")
                _maybe_flush_final()

        else:
            if state.in_speech:
                state.utterance_buf.extend(frame)
                if state.last_silence_ms == 0:
                    state.last_silence_ms = now_ms
                silence_elapsed = now_ms - state.last_silence_ms
                if silence_elapsed >= _SILENCE_MS:
                    # ── Speech offset — endpoint reached ─────────────────
                    logger.debug(f"[STT] VAD endpoint after {silence_elapsed} ms silence.")
                    _maybe_flush_final()
            else:
                # Background noise — just update pre-roll ring
                state.preroll.append(frame)

    # ── Main receive loop ──────────────────────────────────────────────────

    try:
        while True:
            msg = await websocket.receive()

            # ── Binary: raw PCM16LE frame ──────────────────────────────
            if "bytes" in msg and msg["bytes"]:
                raw: bytes = msg["bytes"]

                # Safety ceiling
                state.total_buf_bytes += len(raw)
                if state.total_buf_bytes > _MAX_SESSION_BUFFER:
                    logger.warning("[STT] Session buffer ceiling hit — resetting.")
                    state.reset_utterance()
                    state.total_buf_bytes = 0
                    continue

                # Accumulate received audio time
                n_frames = len(raw) // _FRAME_BYTES
                rem = len(raw) % _FRAME_BYTES
                state.received_ms += n_frames * 32
                if rem:
                    state.received_ms += int(rem / _FRAME_BYTES * 32)

                # Process each 32 ms frame through VAD
                offset = 0
                while offset + _FRAME_BYTES <= len(raw):
                    frame = raw[offset: offset + _FRAME_BYTES]
                    _process_vad_frame(frame)
                    offset += _FRAME_BYTES

                # Schedule periodic interim preview while in speech
                now_ms = state.received_ms
                if (
                    state.in_speech
                    and not state.pending_interim
                    and len(state.utterance_buf) >= 2048  # >= 64 ms (2 frames) — fire ASAP
                    and (now_ms - state.last_interim_ms) >= _INTERIM_INTERVAL_MS
                ):
                    state.last_interim_ms = now_ms
                    state.pending_interim = True
                    data_snap = bytes(state.utterance_buf)
                    asyncio.create_task(_emit_interim(data_snap))

            # ── Text: control messages ─────────────────────────────────
            elif "text" in msg and msg["text"]:
                try:
                    payload = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue

                action = payload.get("type") or payload.get("action", "")

                if action == "start":
                    # (Re)connection handshake — client sends desired sampleRate
                    sr = payload.get("sampleRate", 16000)
                    if sr != 16000:
                        logger.warning(f"[STT] Client sampleRate={sr} — expected 16000.")
                    await websocket.send_json({"type": "ready", "resume_from_ms": state.received_ms})

                elif action == "finalize":
                    # Explicit flush requested by user action (turn submission)
                    if state.in_speech or len(state.utterance_buf) >= 3200:
                        _maybe_flush_final()
                    else:
                        state.reset_utterance()

                elif action == "reset":
                    state.reset_utterance()
                    stt.reset_vad()

                elif action == "ping":
                    await websocket.send_json({"type": "pong"})

                elif action == "stop":
                    # Graceful session teardown
                    if state.in_speech or len(state.utterance_buf) >= 3200:
                        _maybe_flush_final()
                    break

    except (WebSocketDisconnect, RuntimeError):
        logger.info(f"[STT] Client disconnected: session_id={session_id}")
    except Exception as exc:
        logger.error(f"[STT] Unexpected error: {exc}")
    finally:
        # Give any in-flight tasks a moment to emit their results
        await asyncio.sleep(0.1)
        logger.info(f"[STT] Session closed: session_id={session_id}")
