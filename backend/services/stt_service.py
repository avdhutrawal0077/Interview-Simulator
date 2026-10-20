"""
backend/services/stt_service.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Local Streaming STT Service — Phase 2
Uses faster-whisper with CTranslate2 backend (CUDA float16 on RTX 4070).
Bundled Silero VAD model (via faster_whisper.vad) drives endpointing.

Design decisions:
- Singleton loaded once at app lifespan startup → zero cold-start lag per WS connection.
- Single-worker ThreadPoolExecutor for inference → no GPU contention between sessions.
- Bounded async queue: drops INTERIM jobs under load, never drops FINAL jobs.
- Anti-hallucination: rejects phrases with no_speech_prob > 0.6, avg_logprob < -1.0,
  or known silence hallucination tokens.
"""

from __future__ import annotations

import asyncio
import io
import logging
import os
import struct
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import NamedTuple, Optional

import numpy as np

logger = logging.getLogger("InterviewSimulator.STT")

# ─── Windows NVIDIA CUDA DLL Discovery ───────────────────────────────────────
if sys.platform == "win32":
    for _sub in ["cublas", "cudnn"]:
        _p = os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", _sub, "bin")
        if os.path.isdir(_p):
            try:
                os.add_dll_directory(_p)
                os.environ["PATH"] = _p + os.pathsep + os.environ.get("PATH", "")
                logger.info(f"[STT] Discovered CUDA DLL directory: {_p}")
            except Exception:
                pass

# ─── Anti-hallucination: known silence/filler hallucinations ─────────────────
_SILENCE_TOKENS: frozenset[str] = frozenset({
    "", ".", "..", "...", " ", "you", "thank you", "thanks",
    "thanks for watching", "bye", "bye bye", "okay", "ok",
    "um", "uh", "hmm", "[silence]", "(silence)", "silence",
    "♪", "[ music ]", "[music]", "(music)",
    # Additional common Whisper hallucinations on near-silence:
    "please", "please subscribe", "subscribe", "like and subscribe",
    "subtitles by", "subtitles", "captions", "www", "com",
    "[applause]", "(applause)", "[laughter]", "(laughter)",
    "[ Silence ]", "[ silence ]",
})

# Probability thresholds (tightened from defaults to reduce hallucinations)
# no_speech_prob: reject if model thinks there's likely no speech (0→1).
# Lower threshold = more aggressive rejection of non-speech.
_NO_SPEECH_PROB_THRESHOLD = 0.45   # was 0.60
# avg_logprob: reject if model confidence is too low (more negative = less confident).
# Higher (less negative) threshold = require higher confidence.
_AVG_LOGPROB_THRESHOLD    = -0.8   # was -1.0
# Minimum meaningful segment duration in seconds.
# Very short segments (<0.3s) are almost always noise bursts, not real speech.
_MIN_SEGMENT_DURATION_S   = 0.3


def _load_stt_config() -> dict:
    """Read STT environment variables with sane defaults."""
    model_name = os.getenv("STT_MODEL", "auto")
    device = os.getenv("STT_DEVICE", "auto")
    compute_type = os.getenv("STT_COMPUTE_TYPE", "auto")
    language = os.getenv("STT_LANGUAGE", "en")
    beam_size = int(os.getenv("STT_BEAM_SIZE", "5"))
    silence_ms = int(os.getenv("STT_ENDPOINT_SILENCE_MS", "900"))
    initial_prompt = os.getenv(
        "STT_INITIAL_PROMPT",
        "Technical job interview: software engineering, algorithms, React, Python, "
        "system design, databases, cloud architecture.",
    )
    return dict(
        model_name=model_name,
        device=device,
        compute_type=compute_type,
        language=language,
        beam_size=beam_size,
        silence_ms=silence_ms,
        initial_prompt=initial_prompt,
    )


def _resolve_hardware(cfg: dict) -> tuple[str, str, str]:
    """Auto-detect best device / compute_type / model for the current hardware."""
    try:
        import ctranslate2
        cuda_count = ctranslate2.get_cuda_device_count()
    except Exception:
        cuda_count = 0

    device = cfg["device"]
    compute_type = cfg["compute_type"]
    model_name = cfg["model_name"]

    if device == "auto":
        device = "cuda" if cuda_count > 0 else "cpu"

    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    if model_name == "auto":
        if device == "cuda":
            model_name = "large-v3-turbo"
        else:
            model_name = "small.en"

    logger.info(
        f"[STT] Hardware: device={device}, compute_type={compute_type}, "
        f"model={model_name}, cuda_devices={cuda_count}"
    )
    return device, compute_type, model_name


class TranscriptResult(NamedTuple):
    text: str
    is_final: bool
    seq: int
    audio_end_ms: int


class STTService:
    """
    Singleton service. Call `STTService.instance()` to get the shared object.
    Must be initialised via `await service.load()` before use.
    """

    _instance: Optional["STTService"] = None

    @classmethod
    def instance(cls) -> "STTService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self) -> None:
        self._cfg = _load_stt_config()
        self._model = None          # faster_whisper.WhisperModel
        self._vad_model = None      # SileroVADModel
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="stt-final")
        self._interim_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="stt-interim")
        self._ready = False
        self._loading = False
        self._error: Optional[str] = None

    # ─────────────────────────────────────────────────────────────────────────
    # Lifecycle
    # ─────────────────────────────────────────────────────────────────────────

    async def load(self) -> None:
        """Load Whisper model + VAD model in background thread. Safe to call multiple times."""
        if self._ready or self._loading:
            return
        self._loading = True
        self._error = None
        try:
            await asyncio.get_event_loop().run_in_executor(self._executor, self._load_sync)
            self._ready = True
            logger.info("[STT] Model loaded and warmed up — ready for inference.")
        except Exception as exc:
            self._error = str(exc)
            logger.error(f"[STT] Failed to load model: {exc}")
        finally:
            self._loading = False

    def _load_sync(self) -> None:
        """Blocking model load — runs in executor thread."""
        from faster_whisper import WhisperModel
        from faster_whisper.vad import get_vad_model

        # Attempt to add NVIDIA site-packages DLLs to Windows search path
        if sys.platform == "win32":
            for sub in ["cublas", "cudnn"]:
                p = os.path.join(sys.prefix, "Lib", "site-packages", "nvidia", sub, "bin")
                if os.path.isdir(p):
                    try:
                        os.add_dll_directory(p)
                        logger.info(f"[STT] Added DLL directory: {p}")
                    except Exception:
                        pass

        device, compute_type, model_name = _resolve_hardware(self._cfg)
        self._cfg["_device"] = device
        self._cfg["_compute_type"] = compute_type
        self._cfg["_model_name"] = model_name

        cache_dir = os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "whisper")
        logger.info(f"[STT] Loading WhisperModel '{model_name}' on {device} ({compute_type}) …")
        t0 = time.time()

        # Load with CUDA, and auto-fallback to CPU if cublas/cudnn DLLs are missing
        try:
            self._model = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                download_root=cache_dir,
            )
            # Pre-warm: verify CUDA kernel execution
            silence = np.zeros(8000, dtype=np.float32)
            audio_bytes = (silence * 32767).astype(np.int16).tobytes()
            self._transcribe_pcm(audio_bytes, beam_size=1)
        except Exception as exc:
            if device == "cuda":
                logger.warning(
                    f"[STT] CUDA execution failed ({exc}). "
                    f"Falling back to CPU with int8 quantization."
                )
                device = "cpu"
                compute_type = "int8"
                self._cfg["_device"] = device
                self._cfg["_compute_type"] = compute_type
                self._model = WhisperModel(
                    model_name,
                    device="cpu",
                    compute_type="int8",
                    download_root=cache_dir,
                )
                silence = np.zeros(8000, dtype=np.float32)
                audio_bytes = (silence * 32767).astype(np.int16).tobytes()
                self._transcribe_pcm(audio_bytes, beam_size=1)
            else:
                raise

        logger.info(f"[STT] WhisperModel ready on {device} ({compute_type}) in {time.time() - t0:.1f}s")

        logger.info("[STT] Loading Silero VAD model …")
        self._vad_model = get_vad_model()
        logger.info("[STT] Silero VAD ready.")
        logger.info("[STT] Model warm-up complete.")

    @property
    def is_ready(self) -> bool:
        return self._ready

    @property
    def is_loading(self) -> bool:
        return self._loading

    @property
    def error(self) -> Optional[str]:
        return self._error

    @property
    def device(self) -> str:
        return self._cfg.get("_device", "unknown")

    # ─────────────────────────────────────────────────────────────────────────
    # Inference
    # ─────────────────────────────────────────────────────────────────────────

    def _transcribe_pcm(self, pcm_bytes: bytes, beam_size: int = 5, initial_prompt: str = None) -> str:
        """
        Transcribe raw PCM16LE mono 16 kHz bytes.
        Returns cleaned transcript string or '' on silence/hallucination.
        """
        if not self._model:
            return ""
        if len(pcm_bytes) < 3200:   # < 0.1s of audio — skip
            return ""

        # Convert PCM16 → float32 numpy
        samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        # Use per-session prompt if provided, fall back to config default
        prompt = initial_prompt if initial_prompt else self._cfg.get("initial_prompt", "")

        segments_gen, info = self._model.transcribe(
            samples,
            language=self._cfg.get("language", "en"),
            beam_size=beam_size,
            condition_on_previous_text=False,
            initial_prompt=prompt,
            vad_filter=False,   # VAD is handled by the WebSocket router
            word_timestamps=False,
            temperature=0,      # greedy decode — deterministic & fastest
        )

        parts: list[str] = []
        for seg in segments_gen:
            # Anti-hallucination checks per segment
            if seg.no_speech_prob > _NO_SPEECH_PROB_THRESHOLD:
                logger.debug(f"[STT] Rejected segment (no_speech_prob={seg.no_speech_prob:.2f}): {seg.text!r}")
                continue
            if seg.avg_logprob < _AVG_LOGPROB_THRESHOLD:
                logger.debug(f"[STT] Rejected segment (avg_logprob={seg.avg_logprob:.2f}): {seg.text!r}")
                continue
            # Reject very short segments — almost always noise hallucinations
            seg_duration = seg.end - seg.start
            if seg_duration < _MIN_SEGMENT_DURATION_S:
                logger.debug(f"[STT] Rejected segment (duration={seg_duration:.2f}s < {_MIN_SEGMENT_DURATION_S}s): {seg.text!r}")
                continue
            text = seg.text.strip()
            if text.lower() in _SILENCE_TOKENS:
                logger.debug(f"[STT] Rejected segment (silence token): {text!r}")
                continue
            parts.append(text)

        result = " ".join(parts).strip()
        if result.lower() in _SILENCE_TOKENS:
            return ""
        return result

    async def transcribe_interim(self, pcm_bytes: bytes, initial_prompt: str = None) -> str:
        """
        Fast interim transcription (beam_size=1, greedy decode, lowest latency).
        Runs on a *separate* executor so it never blocks final transcriptions.
        Intended for live text previews every ~200 ms.
        """
        if not self._ready:
            return ""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self._interim_executor,
            lambda: self._transcribe_pcm(pcm_bytes, beam_size=1, initial_prompt=initial_prompt),
        )

    async def transcribe_final(self, pcm_bytes: bytes, initial_prompt: str = None) -> str:
        """
        High-quality final transcription (beam_size from config, default 5).
        Called when VAD detects speech endpoint.
        """
        if not self._ready:
            return ""
        loop = asyncio.get_event_loop()
        beam = self._cfg.get("beam_size", 5)
        return await loop.run_in_executor(
            self._executor,
            lambda: self._transcribe_pcm(pcm_bytes, beam_size=beam, initial_prompt=initial_prompt),
        )

    # ─────────────────────────────────────────────────────────────────────────
    # VAD helpers
    # ─────────────────────────────────────────────────────────────────────────

    def vad_score(self, pcm_frame_16k: bytes) -> float:
        """
        Score a 32 ms PCM16LE mono 16 kHz frame (512 samples / 1024 bytes).
        Returns speech probability [0.0, 1.0].
        """
        if not self._vad_model or len(pcm_frame_16k) < 1024:
            return 0.0
        try:
            samples = np.frombuffer(pcm_frame_16k[:1024], dtype=np.int16).astype(np.float32) / 32768.0
            audio_2d = np.expand_dims(samples, axis=0)
            out = self._vad_model(audio_2d, 512)
            return float(np.squeeze(out))
        except Exception:
            return 0.0

    def reset_vad(self) -> None:
        """Reset Silero VAD internal state (call between utterances)."""
        try:
            if self._vad_model:
                self._vad_model.reset_states()
        except Exception:
            pass
