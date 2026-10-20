"""
backend/services/name_corrector.py
───────────────────────────────────
Post-processing corrector for proper nouns (names, colleges, companies, cities)
that faster-whisper mishears — especially for Indian English speakers.

Design:
  1. At WebSocket connect-time, build a per-session alias map from the stored
     resume (parsedResume + candidateName + raw resumeText).
  2. For every Whisper output string, split into tokens and try to match each
     token (or bigram / trigram) against the alias map using:
       a) Exact case-insensitive match  → guaranteed replace
       b) Phonetic match (Soundex/NYSIIS)  → near-certain replace
       c) Edit-distance fuzzy match (rapidfuzz) with high threshold
  3. Replace matched spans with the canonical form from the resume.
  4. Regex patterns for "my name is ___" / "I am ___" are also applied to
     anchor corrections when the candidate explicitly introduces themselves.

This runs in microseconds — pure string operations, no model inference.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from typing import Optional

logger = logging.getLogger("InterviewSimulator.NameCorrector")

# ─── Optional phonetics (jellyfish) ─────────────────────────────────────────
try:
    import jellyfish
    _HAVE_JELLYFISH = True
except ImportError:
    _HAVE_JELLYFISH = False
    logger.warning("[NameCorrector] jellyfish not installed — phonetic matching disabled")

# ─── Fuzzy matching (rapidfuzz) ──────────────────────────────────────────────
try:
    from rapidfuzz.distance import Indel
    from rapidfuzz import fuzz as _fuzz
    _HAVE_RAPIDFUZZ = True
except ImportError:
    _HAVE_RAPIDFUZZ = False
    logger.warning("[NameCorrector] rapidfuzz not installed — fuzzy matching disabled")

# Minimum similarity score (0–100) for rapidfuzz token replacement
_FUZZY_THRESHOLD = 78
# Minimum canonical token length to attempt fuzzy matching (avoids false positives on short words)
_MIN_FUZZY_LEN = 4
# Threshold for whole-name self-introduction matching (can be lower since context anchors it)
_NAME_INTRO_THRESHOLD = 62


def _normalize(s: str) -> str:
    """Lowercase, strip accents, remove punctuation."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^\w\s]", "", s).lower().strip()


def _soundex(word: str) -> str:
    if _HAVE_JELLYFISH:
        try:
            return jellyfish.soundex(word)
        except Exception:
            pass
    return ""


def _nysiis(word: str) -> str:
    if _HAVE_JELLYFISH:
        try:
            return jellyfish.nysiis(word)
        except Exception:
            pass
    return ""


# ─── Proper-noun extraction ───────────────────────────────────────────────────

# Common English stop words — never considered proper nouns
_STOP_WORDS = frozenset({
    "the", "a", "an", "in", "on", "at", "of", "and", "or", "for",
    "to", "from", "by", "with", "is", "was", "are", "were", "be",
    "have", "has", "had", "do", "does", "did", "will", "would",
    "could", "should", "may", "might", "i", "my", "me", "we", "our",
    "you", "your", "he", "she", "they", "it", "this", "that",
    "which", "who", "what", "when", "where", "how", "why",
    "am", "been", "being", "also", "as", "but", "if", "not",
    "no", "so", "than", "then", "there", "these", "those",
    "into", "about", "after", "before", "during", "while",
    "through", "over", "under", "between", "among", "within",
})

# Common generic words that appear in resumes but are NOT proper nouns
_GENERIC_RESUME_WORDS = frozenset({
    "university", "college", "institute", "technology", "engineering",
    "science", "management", "business", "bachelor", "master", "degree",
    "software", "developer", "engineer", "manager", "analyst", "intern",
    "senior", "junior", "lead", "principal", "director", "associate",
    "experience", "skills", "education", "project", "projects", "work",
    "internship", "full", "time", "part", "stack", "backend", "frontend",
    "data", "machine", "learning", "deep", "neural", "network", "cloud",
    "devops", "system", "design", "architecture", "database", "api",
    "mobile", "web", "app", "application", "platform", "service",
    "research", "development", "production", "testing", "deployment",
    "certification", "certified", "professional", "awarded", "honors",
    "distinction", "gpa", "cgpa", "percentage", "marks", "grade",
    "responsible", "developed", "designed", "implemented", "built",
    "created", "managed", "led", "worked", "collaborated", "team",
    "using", "used", "with", "based", "driven", "oriented",
})


def _extract_proper_nouns(text: str) -> list[str]:
    """
    Extract likely proper nouns from resume text.
    Strategy: any word/phrase starting with a capital letter that is NOT
    a common English word or generic resume term.
    Returns a deduplicated list of canonical forms.
    """
    found: list[str] = []
    seen: set[str] = set()

    # Multi-word sequences of capitalised tokens (up to 4 words)
    # e.g. "Indian Institute of Technology", "Avdhut Rawal", "Tata Consultancy Services"
    tokens = text.split()
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        # Must start with uppercase
        if not tok or not tok[0].isupper():
            i += 1
            continue
        # Extend: collect consecutive tokens that start with uppercase OR are
        # stop-word connectors ("of", "and", "the") surrounded by capitals
        span = [tok]
        j = i + 1
        while j < len(tokens) and len(span) < 4:
            next_tok = tokens[j]
            norm = next_tok.lower().rstrip(".,;:")
            if next_tok and next_tok[0].isupper():
                span.append(next_tok)
                j += 1
            elif norm in {"of", "and", "the", "&"} and j + 1 < len(tokens) and tokens[j + 1][0:1].isupper():
                span.append(next_tok)
                j += 1
            else:
                break

        # Evaluate spans from longest to shortest (greedy)
        for length in range(len(span), 0, -1):
            phrase = " ".join(span[:length])
            clean = phrase.strip(".,;:()")
            words = clean.split()

            # Reject if all words are generic / stop words
            all_generic = all(
                w.lower() in _STOP_WORDS or w.lower() in _GENERIC_RESUME_WORDS
                for w in words
            )
            if all_generic:
                break

            # Reject single very short tokens (likely abbreviation artefacts like "I", "A")
            if len(words) == 1 and len(clean) <= 2:
                break

            norm_key = clean.lower()
            if norm_key not in seen:
                seen.add(norm_key)
                found.append(clean)
            i = i + length - 1
            break

        i += 1

    return found


# ─── NameCorrector ────────────────────────────────────────────────────────────

class NameCorrector:
    """
    Per-session post-processor that corrects proper-noun mishearings in
    faster-whisper output.

    Usage:
        corrector = NameCorrector.from_session(session_data)
        fixed = corrector.correct("my name is udo tauve")
        # → "my name is Avdhut Rawal"
    """

    def __init__(self, proper_nouns: list[str]) -> None:
        """
        proper_nouns: list of canonical proper noun strings extracted from resume
                      e.g. ["Avdhut Rawal", "VJTI", "Tata Consultancy Services", "Pune"]
        """
        # Build lookup structures
        self._canonical: list[str] = []          # original casing
        self._canonical_lower: list[str] = []    # lowercased for exact match
        self._soundex_map: dict[str, str] = {}   # soundex code → canonical
        self._nysiis_map: dict[str, str] = {}    # NYSIIS code → canonical

        for phrase in proper_nouns:
            phrase = phrase.strip()
            if not phrase:
                continue
            self._canonical.append(phrase)
            self._canonical_lower.append(phrase.lower())

            # Build per-word phonetic codes for each token in the phrase
            for word in phrase.split():
                if len(word) < 3:
                    continue
                sd = _soundex(word)
                ny = _nysiis(word)
                if sd and sd not in self._soundex_map:
                    self._soundex_map[sd] = word  # map to the individual word
                if ny and ny not in self._nysiis_map:
                    self._nysiis_map[ny] = word

        # Also build whole-phrase fuzzy lookup list (for rapidfuzz)
        self._phrases_for_fuzzy = [
            (ph.lower(), ph) for ph in self._canonical if len(ph) >= _MIN_FUZZY_LEN
        ]

        # Separate list of full candidate names (multi-word) for intro-pattern matching
        # These are matched as a whole against the whisper output span after "my name is"
        self._full_names: list[tuple[str, str]] = [
            (ph.lower(), ph)
            for ph in self._canonical
            if len(ph.split()) >= 2  # must be at least first + last name
        ]

        noun_count = len(self._canonical)
        logger.info(
            f"[NameCorrector] Built alias map: {noun_count} proper nouns, "
            f"{len(self._soundex_map)} soundex codes, "
            f"{len(self._nysiis_map)} NYSIIS codes"
        )

    # ── Factory ───────────────────────────────────────────────────────────────

    @classmethod
    def from_session(cls, session: dict) -> "NameCorrector":
        """Build a NameCorrector from a session_store session dict."""
        proper_nouns: list[str] = []

        # 1. Candidate name (highest priority — always include)
        candidate_name = session.get("candidateName", "").strip()
        if candidate_name and candidate_name.lower() not in ("candidate", ""):
            proper_nouns.append(candidate_name)
            # Also add individual name tokens so first-name-only mentions are caught
            for tok in candidate_name.split():
                if len(tok) >= 3:
                    proper_nouns.append(tok)

        # 2. Parsed resume structured fields
        parsed: dict = session.get("parsedResume", {}) or {}

        # Name from parsed (may differ slightly from candidateName)
        parsed_name = parsed.get("name", "").strip()
        if parsed_name and parsed_name.lower() not in ("candidate", ""):
            proper_nouns.append(parsed_name)

        # Education institutions
        for edu in parsed.get("education", []) or []:
            inst = edu.get("institution", "").strip()
            if inst:
                proper_nouns.append(inst)
            degree = edu.get("degree", "").strip()
            if degree:
                proper_nouns.append(degree)

        # Company names
        for exp in parsed.get("experience", []) or []:
            company = exp.get("company", "").strip()
            if company:
                proper_nouns.append(company)
            role = exp.get("role", "").strip()
            if role:
                proper_nouns.append(role)

        # 3. Raw resume text — extract capitalised noun phrases
        raw_text = session.get("resumeText", "") or ""
        if raw_text:
            raw_nouns = _extract_proper_nouns(raw_text[:3000])
            proper_nouns.extend(raw_nouns)

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique: list[str] = []
        for noun in proper_nouns:
            key = noun.lower()
            if key not in seen:
                seen.add(key)
                unique.append(noun)

        logger.info(f"[NameCorrector] Extracted {len(unique)} unique proper nouns from session")
        return cls(unique)

    # ── Core correction logic ─────────────────────────────────────────────────

    def correct(self, text: str) -> str:
        """
        Apply proper-noun correction to a Whisper transcript string.
        Returns the corrected string (or the original if nothing matched).
        """
        if not text or not self._canonical:
            return text

        # Phase 0: self-introduction pattern — highest-confidence anchor
        # e.g. "my name is udo tauve" → "my name is Avdhut Rawal"
        text = self._correct_self_intro(text)

        # Phase 1: Try to correct whole-phrase spans (multi-word proper nouns)
        text = self._correct_phrases(text)

        # Phase 2: Token-level correction (individual words)
        text = self._correct_tokens(text)

        return text

    def _correct_self_intro(self, text: str) -> str:
        """
        Detect self-introduction patterns and fuzzy-match the name span
        against the full candidate name list.

        Handles patterns like:
          "my name is udo tauve"  → "my name is Avdhut Rawal"
          "I am avdoot raval"     → "I am Avdhut Rawal"
          "this is avdhut"        → token-level handles this
        """
        if not _HAVE_RAPIDFUZZ or not self._full_names:
            return text

        # Patterns that introduce a person's name — capture everything after the keyword
        intro_patterns = [
            r"(?i)(my name is )(.+?)([,.]|$)",
            r"(?i)(i am )([A-Z][a-z]+ [A-Z][a-z]+)([,.]|$)",
            r"(?i)(i'm )([A-Z][a-z]+ [A-Z][a-z]+)([,.]|$)",
            r"(?i)(call me )(.+?)([,.]|$)",
        ]

        for pattern in intro_patterns:
            m = re.search(pattern, text)
            if not m:
                continue
            prefix = m.group(1)    # e.g. "my name is "
            name_span = m.group(2).strip()  # e.g. "udo tauve"
            suffix = m.group(3)    # e.g. "." or ""

            # Fuzzy-match the whole name_span against each full name
            best_score = 0
            best_name = None
            for canon_lower, canon in self._full_names:
                # Use partial_ratio: handles length mismatch between mishearing and real name
                score = _fuzz.token_sort_ratio(name_span.lower(), canon_lower)
                if score > best_score:
                    best_score = score
                    best_name = canon

            if best_score >= _NAME_INTRO_THRESHOLD and best_name:
                logger.debug(
                    f"[NameCorrector] Intro match: '{name_span}' → '{best_name}' "
                    f"(score={best_score})"
                )
                replacement = prefix + best_name + suffix
                text = text[: m.start()] + replacement + text[m.end() :]
                break  # only apply once

        return text

    def _correct_phrases(self, text: str) -> str:
        """
        Try to match multi-word proper nouns as contiguous spans in the text.
        Works on lowercased comparison but preserves surrounding capitalisation.
        """
        text_lower = text.lower()
        for canonical in self._canonical:
            if len(canonical.split()) < 2:
                continue  # handled by token-level correction
            canon_lower = canonical.lower()
            idx = text_lower.find(canon_lower)
            if idx != -1:
                # Exact phrase found (case-insensitive) — replace with canonical casing
                text = text[:idx] + canonical + text[idx + len(canonical):]
                text_lower = text.lower()
        return text

    def _correct_tokens(self, text: str) -> str:
        """
        Split text into word tokens, try to match and replace each with its
        canonical form using exact, phonetic, and fuzzy strategies.
        Tries trigrams, then bigrams, then unigrams (greedy left-to-right).

        Function words ("is", "at", "in", "a", etc.) are never used as the
        leading token of a multi-word match, preventing "is Avdhut" from
        being consumed as a bigram.
        """
        words = text.split()
        result = []
        skip_next = 0

        for i, word in enumerate(words):
            if skip_next > 0:
                skip_next -= 1
                continue

            word_lower = word.lower().rstrip(".,!?;:'\"()")

            # Never use function words as the LEAD token of a multi-word span.
            # This prevents "is Avdhut" from being treated as a name bigram.
            if word_lower not in _STOP_WORDS:
                # Try trigrams first (e.g. "Tata Consultancy Services")
                if i + 2 < len(words):
                    trigram = word + " " + words[i + 1] + " " + words[i + 2]
                    corrected_trigram = self._match_token(trigram, multi_word=True)
                    if corrected_trigram:
                        result.append(corrected_trigram)
                        skip_next = 2
                        continue

                # Try bigrams (e.g. "Avdhut Rawal", "VJTI Mumbai")
                if i + 1 < len(words):
                    next_lower = words[i + 1].lower().rstrip(".,!?;:'\"()")
                    # Also skip if the NEXT token is a function word to avoid
                    # matching "Avdhut is" as a bigram against "Avdhut Rawal"
                    if next_lower not in _STOP_WORDS:
                        bigram = word + " " + words[i + 1]
                        corrected_bigram = self._match_token(bigram, multi_word=True)
                        if corrected_bigram:
                            result.append(corrected_bigram)
                            skip_next = 1
                            continue

            # Single-token correction
            corrected = self._match_token(word)
            result.append(corrected if corrected else word)

        return " ".join(result)

    def _match_token(self, token: str, multi_word: bool = False) -> Optional[str]:
        """
        Try to match `token` against the canonical proper-noun list.
        Returns the canonical form if matched, else None.
        """
        # Strip punctuation for comparison
        stripped = token.strip(".,!?;:'\"()")
        if not stripped:
            return None

        norm = stripped.lower()

        # 1. Exact match (case-insensitive)
        if norm in self._canonical_lower:
            idx = self._canonical_lower.index(norm)
            return self._preserve_surrounding_punct(token, self._canonical[idx])

        # 2. Phonetic match (single-word tokens only)
        if not multi_word and _HAVE_JELLYFISH and len(stripped) >= 3:
            # Soundex
            sd = _soundex(stripped)
            if sd and sd in self._soundex_map:
                canonical_word = self._soundex_map[sd]
                # Extra guard: lengths shouldn't differ by more than 40%
                if abs(len(stripped) - len(canonical_word)) <= max(2, int(len(canonical_word) * 0.4)):
                    logger.debug(f"[NameCorrector] Soundex match: '{stripped}' → '{canonical_word}'")
                    return self._preserve_surrounding_punct(token, canonical_word)

            # NYSIIS (often better for Indian names)
            ny = _nysiis(stripped)
            if ny and ny in self._nysiis_map:
                canonical_word = self._nysiis_map[ny]
                if abs(len(stripped) - len(canonical_word)) <= max(2, int(len(canonical_word) * 0.4)):
                    logger.debug(f"[NameCorrector] NYSIIS match: '{stripped}' → '{canonical_word}'")
                    return self._preserve_surrounding_punct(token, canonical_word)

        # 3. Fuzzy match (rapidfuzz token ratio)
        if _HAVE_RAPIDFUZZ and len(stripped) >= _MIN_FUZZY_LEN:
            best_score = 0
            best_canonical = None
            for ph_lower, ph_canon in self._phrases_for_fuzzy:
                # Only compare tokens of similar length to avoid false positives
                if abs(len(stripped) - len(ph_lower)) > max(3, int(len(ph_lower) * 0.5)):
                    continue
                score = _fuzz.ratio(norm, ph_lower)
                if score > best_score:
                    best_score = score
                    best_canonical = ph_canon
            if best_score >= _FUZZY_THRESHOLD and best_canonical:
                logger.debug(
                    f"[NameCorrector] Fuzzy match: '{stripped}' → '{best_canonical}' "
                    f"(score={best_score})"
                )
                return self._preserve_surrounding_punct(token, best_canonical)

        return None

    @staticmethod
    def _preserve_surrounding_punct(original: str, replacement: str) -> str:
        """Re-attach leading/trailing punctuation from original onto replacement."""
        prefix = ""
        suffix = ""
        temp = original
        while temp and temp[0] in ".,!?;:'\"(":
            prefix += temp[0]
            temp = temp[1:]
        while temp and temp[-1] in ".,!?;:'\")":
            suffix = temp[-1] + suffix
            temp = temp[:-1]
        return prefix + replacement + suffix


# ─── Null corrector (no-op when session has no resume) ───────────────────────

class _NullCorrector:
    """Returned when there's no session data — passes text through unchanged."""
    def correct(self, text: str) -> str:
        return text


def build_corrector(session: Optional[dict]) -> "NameCorrector | _NullCorrector":
    """
    Safe factory. Returns a _NullCorrector if session is None or has no resume data.
    """
    if not session:
        return _NullCorrector()
    has_name = bool((session.get("candidateName") or "").strip())
    has_text = bool((session.get("resumeText") or "").strip())
    has_parsed = bool(session.get("parsedResume"))
    if not (has_name or has_text or has_parsed):
        return _NullCorrector()
    try:
        return NameCorrector.from_session(session)
    except Exception as exc:
        logger.warning(f"[NameCorrector] Build failed (non-fatal): {exc}")
        return _NullCorrector()
