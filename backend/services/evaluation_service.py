"""
backend/services/evaluation_service.py
─────────────────────────────────────
Per-turn answer evaluation, feature extraction for RAG memory, and final report synthesis.

Key design principle: scoring must be HONEST.
- A 3-word answer like "hello hello hello" should score 1-2/10 on communication.
- An off-topic or irrelevant answer should score low on technical.
- Scores default to 0 for empty answers, not 7.
"""

import time
from typing import Any, Dict, List, Optional

from backend.utils import logger, get_gemini_api_key
from backend.services.llm import generate_json, generate_text


class EvaluationService:

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
        prior_turns: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Evaluate a candidate's spoken answer.

        HONEST scoring rules:
        - Empty / too-short answers (< 5 words) → technical=1, communication=1, confidence=2
        - Off-topic / nonsensical answers → score proportionally low
        - Only actually good answers deserve 7+
        """
        api_key = get_gemini_api_key("evaluation")

        word_count = len(transcript.strip().split()) if transcript.strip() else 0

        # ── Hard-coded floor for trivially short / garbage answers ───────────
        if word_count < 5:
            return {
                "scores": {"technical": 1, "communication": 1, "confidence": 2},
                "feedback": (
                    f"Answer was too short ({word_count} word(s)). "
                    "A meaningful interview response requires at least several complete sentences "
                    "explaining your reasoning, experience, and approach."
                ),
            }

        # ── Build conversation context ────────────────────────────────────────
        history_context = ""
        if prior_turns:
            lines = []
            for t in prior_turns:
                lines.append(
                    f"  Q{t.get('turnId','?')}: {t.get('questionText','')}\\n"
                    f"  A: {t.get('transcript','')[:250]}\\n"
                    f"  Scores: tech={t.get('scores',{}).get('technical','?')} "
                    f"comm={t.get('scores',{}).get('communication','?')}"
                )
            history_context = (
                "\\n\\n=== Prior Q&A Context (do NOT repeat this feedback) ===\\n"
                + "\\n\\n".join(lines)
            )

        prompt = f"""You are a ruthlessly honest senior hiring manager evaluating a candidate for {role}.

Current question: "{question_text}"
Candidate's answer ({word_count} words): "{transcript}"

Non-verbal (MediaPipe):
- Eye contact: {eye_contact:.0f}%
- Blink rate: {blink_rate:.0f} bpm  
- Head stability: {head_stability:.0f}%
{history_context}

STRICT SCORING RULES — be honest, not encouraging:
- Score 1–3: Answer is off-topic, incoherent, or shows no knowledge of the subject
- Score 4–5: Answer touches the topic but is vague, shallow, or incomplete
- Score 6–7: Decent answer with some structure but missing depth or specifics
- Score 8–9: Strong answer with clear reasoning, relevant examples, and good structure
- Score 10: Exceptional — concise, insightful, demonstrates real expertise

A short or irrelevant answer MUST score low (1-4). Do NOT be generous.
If the answer does not address the question at all, technical score must be 1–2.

Output ONLY valid JSON:
{{
  "scores": {{
    "technical": <integer 1-10: technical depth, accuracy, and relevance to {role}>,
    "communication": <integer 1-10: clarity, structure, conciseness — penalize rambling or incoherence>,
    "confidence": <integer 1-10: conviction and presence inferred from word choice and delivery>
  }},
  "feedback": "<2-3 specific sentences referencing THIS answer. Name what was good, what was missing, and one concrete action to improve. Do not be generic.>"
}}"""

        result = generate_json(prompt, api_key)
        if result and "scores" in result:
            # Validate scores are in range
            scores = result["scores"]
            for k in ["technical", "communication", "confidence"]:
                scores[k] = max(1, min(10, int(scores.get(k, 5))))
            return result

        # Heuristic fallback — still honest
        tech = min(6, max(1, word_count // 8))
        comm = min(6, max(1, word_count // 10))
        conf = 4 if word_count > 15 else 2
        return {
            "scores": {"technical": tech, "communication": comm, "confidence": conf},
            "feedback": (
                f"Answer had {word_count} words. "
                "Provide more specific examples and structure your response with a clear opening, "
                "explanation, and conclusion."
            ),
        }

    # ─── Answer Feature Extraction for RAG Memory ────────────────────────────

    @classmethod
    def extract_answer_features(
        cls,
        role: str,
        question_text: str,
        transcript: str,
        turn_id: int,
        scores: Dict[str, Any],
    ) -> Optional[str]:
        """
        Extract structured features from a candidate's answer and return them
        as a single concise string suitable for ChromaDB embedding.

        This gives the question generator rich memory of what the candidate has
        demonstrated, missed, or hinted at — enabling truly adaptive follow-ups.

        Returns None on failure (non-fatal).
        """
        api_key = get_gemini_api_key("evaluation")
        word_count = len(transcript.strip().split()) if transcript.strip() else 0

        # Skip trivially short answers — nothing useful to extract
        if word_count < 8:
            return None

        prompt = f"""You are analysing a candidate's interview answer to extract key features for memory.

Role: {role}
Question (Q{turn_id}): "{question_text}"
Candidate's answer: "{transcript[:800]}"
Scores: technical={scores.get('technical', '?')}/10, communication={scores.get('communication', '?')}/10

Extract features in JSON. Be specific and concise (no filler text).
Return ONLY valid JSON:
{{
  "demonstrated_skills": ["<concrete skill or concept the candidate showed knowledge of>"],
  "knowledge_gaps": ["<specific topic they should know but clearly don't or glossed over>"],
  "topics_covered": ["<main topics mentioned>"],
  "follow_up_angles": [
    "<specific follow-up Q to probe deeper: e.g. 'They mentioned Redis caching but didn't discuss eviction policies'>",
    "<another follow-up angle>"
  ],
  "answer_quality": "<strong|adequate|weak>",
  "key_claim": "<the most important thing they said in 1 sentence>"
}}"""

        try:
            features = generate_json(prompt, api_key)
            if not features:
                return None

            # Compose into a single rich feature string for embedding
            parts = []

            if features.get("key_claim"):
                parts.append(f"Q{turn_id} key claim: {features['key_claim']}")

            demonstrated = features.get("demonstrated_skills", [])
            if demonstrated:
                parts.append(f"Q{turn_id} demonstrated skills: {', '.join(demonstrated[:5])}.")

            gaps = features.get("knowledge_gaps", [])
            if gaps:
                parts.append(f"Q{turn_id} knowledge gaps: {', '.join(gaps[:3])}.")

            follow_ups = features.get("follow_up_angles", [])
            for fu in follow_ups[:2]:
                if fu:
                    parts.append(f"Q{turn_id} follow-up: {fu}")

            quality = features.get("answer_quality", "")
            if quality:
                parts.append(f"Q{turn_id} answer quality: {quality}.")

            if not parts:
                return None

            feature_doc = " | ".join(parts)
            logger.info(f"[Eval] Extracted answer features for turn {turn_id} ({len(feature_doc)} chars)")
            return feature_doc

        except Exception as e:
            logger.warning(f"[Eval] Answer feature extraction failed for turn {turn_id} (non-fatal): {e}")
            return None

    # ─── Final Report Synthesis ───────────────────────────────────────────────

    @classmethod
    def synthesize_final_report(cls, session_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Synthesize the full post-interview debrief.
        Waits up to 10s for pending background evaluations to resolve.
        """
        api_key = get_gemini_api_key("evaluation")
        turns: List[Dict[str, Any]] = session_data.get("turns", [])
        role = session_data.get("role", "Software Engineer")

        # Wait for background evals to settle
        pending = sum(1 for t in turns if t.get("evalPending"))
        if pending:
            logger.info(f"[Report] Waiting for {pending} pending evaluations…")
            deadline = time.time() + 10
            while time.time() < deadline:
                turns = session_data.get("turns", [])
                if not any(t.get("evalPending") for t in turns):
                    break
                time.sleep(0.4)

        turns = session_data.get("turns", [])

        # ── Aggregate scores ──────────────────────────────────────────────────
        tech_scores, comm_scores, conf_scores = [], [], []
        eye_contacts, blink_rates, head_stabs = [], [], []

        for t in turns:
            s = t.get("scores", {})
            tech = s.get("technical", 0)
            comm = s.get("communication", 0)
            conf = s.get("confidence", 0)
            # Only include turns that have real scores (not still placeholder zeros)
            if tech > 0 or comm > 0:
                tech_scores.append(tech)
                comm_scores.append(comm)
                conf_scores.append(conf)
            bl = t.get("bodyLanguageMetrics", {})
            # Only include non-default body language metrics
            ec = bl.get("eyeContact")
            br = bl.get("blinkRate")
            hs = bl.get("headStability")
            if ec is not None:
                eye_contacts.append(ec)
            if br is not None:
                blink_rates.append(br)
            if hs is not None:
                head_stabs.append(hs)

        def _avg(lst, default=0.0):
            return round(sum(lst) / len(lst), 1) if lst else default

        avg_tech  = _avg(tech_scores, 5.0)
        avg_comm  = _avg(comm_scores, 5.0)
        avg_conf  = _avg(conf_scores, 5.0)
        avg_eye   = _avg(eye_contacts, 75.0)
        avg_blink = _avg(blink_rates, 15.0)
        avg_head  = _avg(head_stabs, 80.0)

        delivery_bonus = round((avg_eye / 100) * 1.5, 1)
        avg_fit = round(min(10.0,
            (avg_tech * 0.5 + avg_comm * 0.3 + avg_conf * 0.2) + delivery_bonus), 1)

        # ── Q&A summary for synthesis ─────────────────────────────────────────
        qa_summary = ""
        for t in turns:
            qa_summary += (
                f"Q{t.get('turnId','?')}: {t.get('questionText','')}\\n"
                f"A: {t.get('transcript','')[:400]}\\n"
                f"Scores → Tech:{t.get('scores',{}).get('technical','?')} "
                f"Comm:{t.get('scores',{}).get('communication','?')} "
                f"Conf:{t.get('scores',{}).get('confidence','?')}\\n"
                f"Feedback: {t.get('feedback','')}\\n\\n"
            )

        # ── Use session RAG memory if available ───────────────────────────────
        rag_memory_context = ""
        try:
            from backend.services.rag_service import rag_service
            session_id = session_data.get("sessionId", "")
            if session_id:
                memory = rag_service.get_session_memory(session_id)
                answer_insights = memory.get("answer_insight", [])
                resume_features = memory.get("resume_feature", [])
                if answer_insights or resume_features:
                    rag_memory_context = "\\n\\n=== Session Memory (RAG) ===\\n"
                    if resume_features:
                        rag_memory_context += "Resume highlights:\\n" + "\\n".join(
                            f"  - {f}" for f in resume_features[:4]
                        )
                    if answer_insights:
                        rag_memory_context += "\\nAnswer insights:\\n" + "\\n".join(
                            f"  - {f}" for f in answer_insights[:6]
                        )
        except Exception as e:
            logger.debug(f"[Report] Could not fetch RAG memory: {e}")

        prompt = f"""You are a senior talent acquisition specialist writing a confidential post-interview debrief for the role of '{role}'.

=== Interview Transcript & Scores ===
{qa_summary}
=== Aggregated Scores ===
Technical:     {avg_tech}/10
Communication: {avg_comm}/10
Confidence:    {avg_conf}/10
Role Fit:      {avg_fit}/10

=== Non-Verbal Metrics ===
Eye Contact:    {avg_eye}%
Blink Rate:     {avg_blink} bpm
Head Stability: {avg_head}%
{rag_memory_context}

Be HONEST and specific. Reference actual answers, questions, and scores from above.
If scores are low (< 5), the strengths and debrief must reflect that honestly.
Do NOT invent strengths that aren't supported by the transcript data.

Output ONLY valid JSON:
{{
  "strengths": [
    "<specific strength 1 referencing a concrete answer or moment from the transcript>",
    "<specific strength 2>",
    "<specific strength 3>"
  ],
  "improvements": [
    "<actionable improvement 1 with concrete advice specific to what they said>",
    "<actionable improvement 2>",
    "<actionable improvement 3>"
  ],
  "debrief_narrative": "<2–3 paragraph honest executive summary. Be specific. Reference actual answers, scores, and non-verbal data.>",
  "hiring_recommendation": "<one of: Strong Yes | Yes | Maybe | No>",
  "skill_gaps": ["<gap 1>", "<gap 2>", "<gap 3>"],
  "topic_coverage": {{
    "covered_well": ["<topic 1>", "<topic 2>"],
    "needs_improvement": ["<topic 1>", "<topic 2>"]
  }}
}}"""

        synthesis = generate_json(prompt, api_key)

        if not synthesis or "strengths" not in synthesis:
            low = avg_tech < 5
            synthesis = {
                "strengths": [
                    "Attempted to respond to all interview questions.",
                    f"Maintained {avg_eye:.0f}% eye contact during the session.",
                    "Showed up and engaged with the process.",
                ],
                "improvements": [
                    "Provide longer, more structured answers with specific examples.",
                    "Study the technical fundamentals required for this role before re-attempting.",
                    "Practice the STAR method (Situation, Task, Action, Result) for behavioral questions.",
                ],
                "debrief_narrative": (
                    f"The candidate completed {len(turns)} question(s) for the {role} role. "
                    f"Technical score of {avg_tech}/10 and communication score of {avg_comm}/10 "
                    f"{'indicate significant room for improvement' if low else 'show a competent profile'}. "
                    f"Non-verbal delivery: {avg_eye:.0f}% eye contact, {avg_head:.0f}% head stability."
                ),
                "hiring_recommendation": "No" if avg_tech < 4 else ("Maybe" if avg_tech < 6 else "Yes"),
                "skill_gaps": [],
                "topic_coverage": {"covered_well": [], "needs_improvement": []},
            }

        logger.info(f"[Report] Synthesized — Tech={avg_tech} Comm={avg_comm} Conf={avg_conf} Fit={avg_fit}")

        return {
            "overall_scores": {
                "technical":     avg_tech,
                "communication": avg_comm,
                "confidence":    avg_conf,
                "role_fit":      avg_fit,
            },
            "body_language": {
                "eye_contact":    avg_eye,
                "blink_rate":     avg_blink,
                "head_stability": avg_head,
            },
            "strengths":             synthesis.get("strengths", []),
            "improvements":          synthesis.get("improvements", []),
            "debrief_narrative":     synthesis.get("debrief_narrative", ""),
            "hiring_recommendation": synthesis.get("hiring_recommendation", "Maybe"),
            "skill_gaps":            synthesis.get("skill_gaps", []),
            "topic_coverage":        synthesis.get("topic_coverage", {}),
            "turns":                 turns,
            "role":                  role,
            "total_questions":       len(turns),
        }
