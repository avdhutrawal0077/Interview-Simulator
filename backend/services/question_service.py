"""
backend/services/question_service.py
─────────────────────────────────────
Context-aware interview question generation using RAG + conversation history.

RAG Retrieval Strategy:
  - Queries both raw resume/JD chunks AND structured feature documents
  - Builds a rich query from: role + last topic + known gaps + follow-up angles
  - Retrieves top-k from ChromaDB, mixing resume features and answer insights
"""

from typing import Any, Dict, List, Optional
from backend.utils import logger, get_gemini_api_key
from backend.services.llm import generate_text


class QuestionService:

    @classmethod
    def generate_next_question(
        cls,
        role: str,
        question_index: int,
        total_questions: int,
        resume_text: str = "",
        job_desc_text: str = "",
        turns_history: Optional[List[Dict[str, Any]]] = None,
        session_id: str = "",
    ) -> str:
        api_key = get_gemini_api_key("question")
        turns_history = turns_history or []

        fallback_questions = [
            f"Start by introducing yourself and walking me through your background relevant to this {role} position.",
            "Tell me about the most technically challenging project you've worked on. What made it hard and how did you solve it?",
            "How do you approach debugging a complex issue in production? Walk me through your process.",
            "Describe a time you had a technical disagreement with a teammate. How did you navigate it?",
            "How do you ensure the code you ship is production-quality — what does your review and testing process look like?",
            "What's the biggest technical decision you've made recently, and what trade-offs did you weigh?",
            f"Why are you interested in this {role} role specifically, and what do you bring that others might not?",
            "Do you have any questions for us about the role, the team, or the technical direction?",
        ]

        # ── Build a rich RAG query ────────────────────────────────────────────
        # The query mixes: the role, the last Q&A topic, and extracted gaps/follow-ups
        # from prior turns so ChromaDB can surface the most relevant context.
        rag_context_blocks = {
            "resume_features": [],
            "answer_insights": [],
            "raw_chunks": [],
        }

        if session_id:
            try:
                from backend.services.rag_service import rag_service

                # Build a targeted query from recent turn context
                query_parts = [role]
                if turns_history:
                    last = turns_history[-1]
                    last_q = last.get("questionText", "")
                    last_a = last.get("transcript", "")[:200]
                    if last_q:
                        query_parts.append(last_q)
                    if last_a:
                        query_parts.append(last_a)

                # Add any known gaps from turn feedback
                for t in turns_history[-2:]:  # last 2 turns
                    fb = t.get("feedback", "")
                    if fb and "gap" in fb.lower():
                        query_parts.append(fb[:150])

                query = " ".join(query_parts)

                # 1. Retrieve resume feature documents (skills, hooks, gaps)
                resume_feats = rag_service.query_by_type(
                    session_id, query,
                    doc_types=["resume_feature"],
                    top_k=3,
                )
                rag_context_blocks["resume_features"] = resume_feats

                # 2. Retrieve answer insight documents from prior turns
                answer_insights = rag_service.query_by_type(
                    session_id, query,
                    doc_types=["answer_insight"],
                    top_k=4,
                )
                rag_context_blocks["answer_insights"] = answer_insights

                # 3. Retrieve a couple of raw resume/JD chunks for specific details
                raw_chunks = rag_service.query_by_type(
                    session_id, query,
                    doc_types=["resume", "job_description"],
                    top_k=2,
                )
                rag_context_blocks["raw_chunks"] = raw_chunks

            except Exception as e:
                logger.debug(f"[Question] RAG query failed: {e}")

        # ── Format RAG context for the prompt ────────────────────────────────
        rag_section = ""
        if rag_context_blocks["resume_features"]:
            rag_section += "\n--- Candidate Profile (from Resume Analysis) ---\n"
            rag_section += "\n".join(f"• {r}" for r in rag_context_blocks["resume_features"])

        if rag_context_blocks["answer_insights"]:
            rag_section += "\n\n--- Prior Answer Insights (from AI Evaluation Memory) ---\n"
            rag_section += "\n".join(f"• {r}" for r in rag_context_blocks["answer_insights"])

        if rag_context_blocks["raw_chunks"]:
            rag_section += "\n\n--- Relevant Resume/JD Excerpts ---\n"
            rag_section += "\n".join(f"• {r[:250]}" for r in rag_context_blocks["raw_chunks"])

        # ── Build conversation history summary ────────────────────────────────
        history_lines = ""
        for t in turns_history:
            score_info = ""
            scores = t.get("scores", {})
            if scores.get("technical", 0) > 0:
                score_info = f" [tech={scores.get('technical')}/10, comm={scores.get('communication')}/10]"
            history_lines += (
                f"Q{t.get('turnId','?')}: {t.get('questionText','')}\n"
                f"A: {t.get('transcript','')[:250]}{score_info}\n\n"
            )

        # ── Determine interview phase ─────────────────────────────────────────
        if question_index == 1:
            phase = "Opening (icebreaker / background walkthrough — keep it warm and welcoming)"
        elif question_index <= total_questions // 3:
            phase = "Early stage — explore background and motivations"
        elif question_index <= (2 * total_questions) // 3:
            phase = "Middle stage — dig into technical depth, system design, and problem solving"
        else:
            phase = "Closing stage — behavioral, collaboration, cultural fit, or candidate questions"

        prompt = f"""You are an experienced technical interviewer for {role} at a top tech company.

Interview phase: {phase}
Question {question_index} of {total_questions}.

--- Candidate Resume (key excerpts) ---
{resume_text[:1500] if resume_text else 'Not provided'}

--- Job Requirements ---
{job_desc_text[:800] if job_desc_text else f'Standard {role} expectations'}

{rag_section if rag_section else '--- No RAG context available ---'}

--- Conversation So Far ---
{history_lines if history_lines else 'This is the first question.'}

CRITICAL RULES for question generation:
1. Generate exactly ONE question for this phase.
2. USE the candidate profile and answer insights above to make the question SPECIFIC to this candidate.
   - If the insights mention a knowledge gap, probe it.
   - If a follow-up angle is mentioned, use it.
   - If they demonstrated a skill, go deeper on it.
3. Do NOT repeat any question already asked above.
4. Keep it concise and direct — one clear question, not a compound question.
5. For technical questions, ask about a specific technology, scenario, or decision from their background.
6. Return ONLY the question text. No preamble, no quotes, no numbering."""

        generated = generate_text(prompt, api_key)
        if generated and len(generated.strip()) > 10:
            # Strip any accidental prefixes
            q = generated.strip().lstrip("0123456789.)- ").strip().strip('"').strip("'")
            return q

        idx = min(question_index - 1, len(fallback_questions) - 1)
        return fallback_questions[max(0, idx)]
