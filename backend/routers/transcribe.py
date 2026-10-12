import io
import json
import time
import asyncio
from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.utils import logger, get_gemini_api_key

router = APIRouter(tags=["Transcription"])

# Confirmed working Gemini models (from ModelService.ListModels).
# gemini-3.8-flash is primary, gemini-3.5-flash is stable fallback,
# gemini-flash-latest is the versioned alias fallback.
TRANSCRIBE_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest",
]


def _transcribe_audio_bytes(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """
    Synchronous worker that calls Google Gemini with raw audio bytes.
    Executed in a thread via asyncio.to_thread to keep the WebSocket loop responsive.
    """
    if len(audio_bytes) < 1000:
        # Less than 1 KB is just an audio header with no speech
        return ""

    api_key = get_gemini_api_key("transcribe")
    if not api_key:
        logger.error("[STT WebSocket] No Gemini API key configured for transcription.")
        return ""

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        part = types.Part.from_bytes(data=audio_bytes, mime_type=mime_type)
        prompt = (
            "You are an accurate speech-to-text transcriber for a technical job interview. "
            "Transcribe the spoken English speech exactly as spoken. "
            "Do not add any preamble, explanations, notes, or punctuation commentary. "
            "Return ONLY the spoken words. If the audio is completely silent or has no intelligible speech, "
            "return an empty string."
        )

        for model_name in TRANSCRIBE_MODELS:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[part, prompt],
                )
                if response and response.text:
                    text = response.text.strip()
                    # Filter out non-speech model outputs
                    lower = text.lower()
                    if lower in ["none", "empty", "no speech", "silence", "silent", "[silence]", "(silence)"]:
                        return ""
                    return text
                return ""
            except Exception as e:
                err_str = str(e)
                if "503" in err_str or "UNAVAILABLE" in err_str or "404" in err_str:
                    logger.warning(f"[STT] Model {model_name} unavailable ({err_str[:60]}), trying fallback...")
                    continue
                logger.error(f"[STT] Transcription error with {model_name}: {e}")
                continue

    except Exception as e:
        logger.error(f"[STT] Exception during transcription: {e}")

    return ""


@router.websocket("/ws/transcribe/{session_id}")
@router.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket, session_id: Optional[str] = "default"):
    """
    WebSocket endpoint for real-time streaming audio transcription.
    Receives binary audio frames from browser MediaRecorder (audio/webm).
    Emits JSON:
        {"type": "interim", "text": "..."}
        {"type": "final", "text": "..."}
    """
    await websocket.accept()
    logger.info(f"[STT WebSocket] Client connected: session_id={session_id}")

    audio_buffer = bytearray()
    last_interim_time = time.time()
    mime_type = "audio/webm"
    is_transcribing = False  # guards interim; finalize uses background tasks
    pending_finalize = False  # prevents duplicate finalize requests

    try:
        while True:
            msg = await websocket.receive()

            if "bytes" in msg and msg["bytes"]:
                chunk = msg["bytes"]
                audio_buffer.extend(chunk)

                # Periodic interim preview: every ~2.2s if we have at least 15KB of audio
                now = time.time()
                if (now - last_interim_time >= 2.2) and (len(audio_buffer) > 15000) and not is_transcribing:
                    last_interim_time = now
                    is_transcribing = True

                    # Run interim transcription in background task so socket read loop doesn't stall
                    async def run_interim(data: bytes, m_type: str):
                        nonlocal is_transcribing
                        try:
                            interim_text = await asyncio.to_thread(_transcribe_audio_bytes, data, m_type)
                            if interim_text:
                                await websocket.send_json({"type": "interim", "text": interim_text})
                        except Exception as e:
                            logger.debug(f"[STT WebSocket] Interim send error: {e}")
                        finally:
                            is_transcribing = False

                    asyncio.create_task(run_interim(bytes(audio_buffer), mime_type))

            elif "text" in msg and msg["text"]:
                try:
                    payload = json.loads(msg["text"])
                    action = payload.get("type") or payload.get("action")

                    if action == "config":
                        if "mimeType" in payload:
                            mime_type = payload["mimeType"]

                    elif action == "finalize":
                        # Candidate paused or finished phrase: transcribe complete utterance buffer
                        # CRITICAL FIX: run transcription in a background task so the receive()
                        # loop is NOT blocked. Previously this used `await asyncio.to_thread`
                        # inline, which stalled the loop for 5-10 seconds while Gemini ran —
                        # causing Vite proxy timeouts and the WebSocket to drop every time.
                        if len(audio_buffer) > 1000 and not pending_finalize:
                            data_to_transcribe = bytes(audio_buffer)
                            audio_buffer = bytearray()  # Reset buffer for next sentence
                            last_interim_time = time.time()
                            pending_finalize = True

                            async def run_finalize(data: bytes, m_type: str):
                                nonlocal pending_finalize
                                try:
                                    final_text = await asyncio.to_thread(_transcribe_audio_bytes, data, m_type)
                                    if final_text:
                                        await websocket.send_json({"type": "final", "text": final_text})
                                    else:
                                        # Even if empty, signal the frontend the finalize completed
                                        logger.debug("[STT WebSocket] Finalize returned empty transcription")
                                except Exception as e:
                                    logger.debug(f"[STT WebSocket] Finalize send error: {e}")
                                finally:
                                    pending_finalize = False

                            asyncio.create_task(run_finalize(data_to_transcribe, mime_type))
                        else:
                            audio_buffer = bytearray()

                    elif action == "reset":
                        audio_buffer = bytearray()
                        last_interim_time = time.time()

                    elif action == "ping":
                        await websocket.send_json({"type": "pong"})

                except json.JSONDecodeError:
                    pass

    except (WebSocketDisconnect, RuntimeError):
        logger.info(f"[STT WebSocket] Client disconnected: session_id={session_id}")
    except Exception as e:
        logger.info(f"[STT WebSocket] Connection closed: {e}")
