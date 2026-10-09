import logging
import os
from dotenv import load_dotenv

load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("InterviewSimulator")

# ─── API Key Loading ─────────────────────────────────────────────────────────
# Load all keys once at startup. Each service gets its own key to avoid
# hitting the free-tier rate limits. Falls back to GEMINI_API_KEY if the
# dedicated key is not set.

_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
_GEMINI_API_KEY_RESUME = os.getenv("GEMINI_API_KEY_RESUME", "") or _GEMINI_API_KEY
_GEMINI_API_KEY_QUESTION = os.getenv("GEMINI_API_KEY_QUESTION", "") or _GEMINI_API_KEY
_GEMINI_API_KEY_EVALUATION = os.getenv("GEMINI_API_KEY_EVALUATION", "") or _GEMINI_API_KEY
_GEMINI_API_KEY_TRANSCRIBE = os.getenv("GEMINI_API_KEY_TRANSCRIBE", "") or _GEMINI_API_KEY_QUESTION or _GEMINI_API_KEY

# Keep GEMINI_API_KEY exported for any legacy imports
GEMINI_API_KEY = _GEMINI_API_KEY


def get_gemini_api_key(service: str = "default") -> str:
    """
    Return the correct Gemini API key for a given service.

    Services:
        "resume"     → GEMINI_API_KEY_RESUME     (PDF parsing + embedding generation)
        "question"   → GEMINI_API_KEY_QUESTION   (question generation + RAG context)
        "evaluation" → GEMINI_API_KEY_EVALUATION (turn scoring + final report debrief)
        "transcribe" → GEMINI_API_KEY_TRANSCRIBE (audio speech transcription)
        "default"    → GEMINI_API_KEY            (generic fallback for any other use)

    If a service-specific key is not set in .env the general GEMINI_API_KEY is
    returned automatically so a single key still works during development.
    """
    key_map = {
        "resume":     _GEMINI_API_KEY_RESUME,
        "question":   _GEMINI_API_KEY_QUESTION,
        "evaluation": _GEMINI_API_KEY_EVALUATION,
        "transcribe": _GEMINI_API_KEY_TRANSCRIBE,
    }
    key = key_map.get(service, _GEMINI_API_KEY)

    if not key:
        logger.warning(
            f"[API Key] No Gemini API key found for service='{service}'. "
            "Set GEMINI_API_KEY (or the service-specific key) in your .env file."
        )
    return key


# ─── Startup Key Validation ───────────────────────────────────────────────────
def _log_key_status() -> None:
    """Log which keys are configured at startup (masked to first 8 chars)."""
    def _mask(k: str) -> str:
        return (k[:8] + "…") if k else "NOT SET"

    logger.info("=== Gemini API Key Configuration ===")
    logger.info(f"  GEMINI_API_KEY (fallback)   : {_mask(_GEMINI_API_KEY)}")
    logger.info(f"  GEMINI_API_KEY_RESUME        : {_mask(_GEMINI_API_KEY_RESUME)}")
    logger.info(f"  GEMINI_API_KEY_QUESTION      : {_mask(_GEMINI_API_KEY_QUESTION)}")
    logger.info(f"  GEMINI_API_KEY_EVALUATION    : {_mask(_GEMINI_API_KEY_EVALUATION)}")
    logger.info(f"  GEMINI_API_KEY_TRANSCRIBE    : {_mask(_GEMINI_API_KEY_TRANSCRIBE)}")
    logger.info("=====================================")

_log_key_status()
