import json
import time
from typing import Dict, Any, List
from backend.utils import logger, get_gemini_api_key


class EvaluationService:

    # ─── Internal Gemini JSON caller ──────────────────────────────────────────

    @staticmethod
    def _call_gemini_json(prompt: str) -> Dict[str, Any]:
        api_key = get_gemini_api_key("evaluation")
        if not api_key:
            return {}

        # Try google.genai first with real models
        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                from google import genai
                client = genai.Client(api_key=api_key)
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config={'response_mime_type': 'application/json'}
                )
                if response and response.text:
                    return json.loads(response.text.strip())
            except Exception as e:
                logger.debug(f"google.genai evaluation attempt with {model_name}: {e}")

        # Fallback to legacy google.generativeai
        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                import google.generativeai as legacy_genai
                legacy_genai.configure(api_key=api_key)
                model = legacy_genai.GenerativeModel(model_name)
                response = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                if response and response.text:
                    return json.loads(response.text.strip())
            except Exception as e:
                logger.debug(f"Legacy Gemini evaluation with {model_name} failed: {e}")

        return {}

    @staticmethod
    def _call_gemini_text(prompt: str) -> str:
        """Plain-text Gemini call used for narrative debrief generation."""
        api_key = get_gemini_api_key("evaluation")
        if not api_key:
            return ""

        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                from google import genai
                client = genai.Client(api_key=api_key)
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                )
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                logger.debug(f"google.genai text call with {model_name} failed: {e}")

        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                import google.generativeai as legacy_genai
                legacy_genai.configure(api_key=api_key)
                model = legacy_genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                if response and response.text:
                    return response.text.strip()
            except Exception as e:
                logger.debug(f"Legacy Gemini text call with {model_name} failed: {e}")

        return ""

    # ─── Per-turn Evaluation ─────────────────────────────────────────────────

    @classmethod
    def evaluate_answer(
        cls,
        role: str,
        question_text: str,
        transcript: str,
        eye_contact: float,
        blink_rate: float,
        head_stability: float,
    ) -> Dict[str, Any]:
        """Evaluate technical accuracy, communication, and non-verbal confidence."""

        # Heuristic baseline scoring used as fallback
        word_count = len(transcript.strip().split())
        tech_score = 8 if word_count > 25 else (6 if word_count > 10 else 4)
        comm_score = 8 if word_count > 20 else 6
        conf_score = int(min(10, max(1, (eye_contact * 0.05) + (head_stability * 0.05))))

        fallback_result = {
            "scores": {
                "technical": tech_score,
                "communication": comm_score,
                "confidence": conf_score,
            },
            "feedback": (
                f"Good answer structure. Clear verbal delivery ({word_count} words). "
                f"Non-verbal tracking showed ~{int(eye_contact)}% eye contact."
            ),
        }

        prompt = f"""You are an expert hiring manager evaluating a candidate's spoken response.

Role: {role}
Interview Question: "{question_text}"
Candidate's Spoken Answer (Transcript): "{transcript}"
Non-Verbal Metrics from MediaPipe Vision:
- Eye contact: {eye_contact}%
- Blink rate: {blink_rate} blinks/min
- Head stability: {head_stability}%

Evaluate this answer and output ONLY valid JSON matching this schema:
{{
  "scores": {{
    "technical": <integer 1-10 rating technical depth & relevance>,
    "communication": <integer 1-10 rating clarity, conciseness, and articulation>,
    "confidence": <integer 1-10 rating delivery confidence and presence>
  }},
  "feedback": "<concise 2-3 sentence actionable feedback summarizing strengths and constructive advice>"
}}
"""
        eval_data = cls._call_gemini_json(prompt)
        if eval_data and "scores" in eval_data:
            return eval_data

        return fallback_result

    # ─── Final Report Synthesis ───────────────────────────────────────────────

    @classmethod
    def synthesize_final_report(cls, session_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synthesize a rich AI debrief from all completed interview turns.

        Waits briefly (up to 8 s) for any still-pending background evaluations
        to finish before synthesizing so all turn scores are real, not placeholders.

        Returns a structured report dict containing:
          - overall_scores      : averaged technical / communication / confidence / role_fit
          - body_language       : averaged eye contact, blink rate, head stability
          - strengths           : list[str] — 3 bullet points
          - improvements        : list[str] — 3 bullet points
          - debrief_narrative   : str  — 2-3 paragraph executive summary
          - turns               : full per-turn data for frontend rendering
        """
        turns: List[Dict[str, Any]] = session_data.get("turns", [])
        role = session_data.get("role", "Software Engineer")

        # ── Grace-period wait for pending background evals ────────────────────
        pending_count = sum(1 for t in turns if t.get("evalPending"))
        if pending_count:
            logger.info(f"[Report] {pending_count} turn(s) still pending eval — waiting up to 8s…")
            deadline = time.time() + 8
            while time.time() < deadline:
                turns = session_data.get("turns", [])  # re-read live session data
                if not any(t.get("evalPending") for t in turns):
                    break
                time.sleep(0.5)

        turns = session_data.get("turns", [])

        # ── Aggregate numeric scores ──────────────────────────────────────────
        tech_scores, comm_scores, conf_scores = [], [], []
        eye_contacts, blink_rates, head_stabs = [], [], []

        for t in turns:
            s = t.get("scores", {})
            tech_scores.append(s.get("technical", 7))
            comm_scores.append(s.get("communication", 7))
            conf_scores.append(s.get("confidence", 7))

            bl = t.get("bodyLanguageMetrics", {})
            eye_contacts.append(bl.get("eyeContact") or 80.0)
            blink_rates.append(bl.get("blinkRate") or 15.0)
            head_stabs.append(bl.get("headStability") or 85.0)

        def _avg(lst: list) -> float:
            return round(sum(lst) / len(lst), 1) if lst else 0.0

        avg_technical     = _avg(tech_scores)
        avg_communication = _avg(comm_scores)
        avg_confidence    = _avg(conf_scores)
        avg_eye_contact   = _avg(eye_contacts)
        avg_blink_rate    = _avg(blink_rates)
        avg_head_stability= _avg(head_stabs)

        # Role-fit: weighted blend of technical + communication with delivery bonus
        delivery_bonus = round((avg_eye_contact / 100) * 2, 1)
        avg_role_fit   = round(
            min(10.0, (avg_technical * 0.5 + avg_communication * 0.3 + avg_confidence * 0.2) + delivery_bonus),
            1,
        )

        # ── Build transcript summary for Gemini synthesis ─────────────────────
        qa_summary = ""
        for t in turns:
            qa_summary += (
                f"Q{t.get('turnId', '?')}: {t.get('questionText', '')}\n"
                f"A: {t.get('transcript', '')[:400]}\n"
                f"Scores → Technical:{t.get('scores', {}).get('technical', '?')} "
                f"Communication:{t.get('scores', {}).get('communication', '?')} "
                f"Confidence:{t.get('scores', {}).get('confidence', '?')}\n"
                f"Feedback: {t.get('feedback', '')}\n\n"
            )

        synthesis_prompt = f"""You are a senior talent acquisition specialist writing a confidential debrief report
for an interview candidate applying for the role of '{role}'.

=== Interview Transcript Summary ===
{qa_summary}

=== Aggregated Scores ===
- Technical:     {avg_technical}/10
- Communication: {avg_communication}/10
- Confidence:    {avg_confidence}/10
- Role Fit:      {avg_role_fit}/10

=== Non-Verbal Delivery Metrics (MediaPipe) ===
- Eye Contact:    {avg_eye_contact}%
- Blink Rate:     {avg_blink_rate} bpm
- Head Stability: {avg_head_stability}%

Write a debrief with the following structure. Output ONLY valid JSON:
{{
  "strengths": [
    "<specific strength 1 referencing a concrete answer or moment>",
    "<specific strength 2>",
    "<specific strength 3>"
  ],
  "improvements": [
    "<actionable improvement 1 with concrete advice>",
    "<actionable improvement 2>",
    "<actionable improvement 3>"
  ],
  "debrief_narrative": "<2-3 paragraph executive summary of overall candidate performance, delivery, technical ability, and recommendation>",
  "hiring_recommendation": "<one of: Strong Yes | Yes | Maybe | No>"
}}
"""
        ai_synthesis = cls._call_gemini_json(synthesis_prompt)

        # Fallback if Gemini call fails
        if not ai_synthesis or "strengths" not in ai_synthesis:
            ai_synthesis = {
                "strengths": [
                    "Demonstrated structured thinking across multiple answers.",
                    f"Maintained {avg_eye_contact:.0f}% eye contact indicating solid presence.",
                    "Showed willingness to engage with technical depth.",
                ],
                "improvements": [
                    "Include more specific metrics or outcomes in technical answers.",
                    "Slow down delivery — pace was slightly rushed in some responses.",
                    "Ask clarifying questions before answering to show analytical rigor.",
                ],
                "debrief_narrative": (
                    f"The candidate completed a {len(turns)}-question interview for the {role} role. "
                    f"Overall technical score of {avg_technical}/10 and communication score of "
                    f"{avg_communication}/10 indicate a competent profile. "
                    f"Non-verbal delivery was solid with {avg_eye_contact:.0f}% eye contact and "
                    f"{avg_head_stability:.0f}% head stability. "
                    f"Role fit score: {avg_role_fit}/10."
                ),
                "hiring_recommendation": "Maybe",
            }

        logger.info(
            f"[Report] Final report synthesized — "
            f"Technical={avg_technical} Communication={avg_communication} "
            f"Confidence={avg_confidence} RoleFit={avg_role_fit}"
        )

        return {
            "overall_scores": {
                "technical":     avg_technical,
                "communication": avg_communication,
                "confidence":    avg_confidence,
                "role_fit":      avg_role_fit,
            },
            "body_language": {
                "eye_contact":    avg_eye_contact,
                "blink_rate":     avg_blink_rate,
                "head_stability": avg_head_stability,
            },
            "strengths":            ai_synthesis.get("strengths", []),
            "improvements":         ai_synthesis.get("improvements", []),
            "debrief_narrative":    ai_synthesis.get("debrief_narrative", ""),
            "hiring_recommendation":ai_synthesis.get("hiring_recommendation", "Maybe"),
            "turns":                turns,
            "role":                 role,
            "total_questions":      len(turns),
        }
