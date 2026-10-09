import json
from typing import Dict, Any, List
from backend.utils import logger, get_gemini_api_key

class QuestionService:
    @staticmethod
    def _call_gemini(prompt: str) -> str:
        api_key = get_gemini_api_key("question")
        if not api_key:
            return ""
        
        # Try google.genai first (new official SDK) with real fallback models
        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                from google import genai
                client = genai.Client(api_key=api_key)
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                )
                if response and response.text:
                    return response.text.strip().strip('"').strip("'")
            except Exception as e:
                logger.debug(f"google.genai call attempt with {model_name}: {e}")

        # Fallback to google.generativeai legacy SDK
        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                import google.generativeai as legacy_genai
                legacy_genai.configure(api_key=api_key)
                model = legacy_genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                if response and response.text:
                    return response.text.strip().strip('"').strip("'")
            except Exception as e:
                logger.debug(f"Legacy Gemini API call with {model_name} failed: {e}")

        return ""

    @classmethod
    def generate_next_question(
        cls,
        role: str,
        question_index: int,
        total_questions: int,
        resume_text: str = "",
        job_desc_text: str = "",
        turns_history: List[Dict[str, Any]] = None,
        session_id: str = ""
    ) -> str:
        turns_history = turns_history or []
        
        fallback_questions = [
            f"Could you start by introducing yourself and highlighting your key background for the {role} position?",
            "Can you walk me through the most technically challenging project you've worked on recently?",
            "How do you approach debugging and root-cause analysis when an unexpected bug occurs in production?",
            "Tell me about a time you had a technical disagreement with a teammate or stakeholder. How did you resolve it?",
            "How do you ensure performance, scalability, and code quality in your system architecture?",
            "What strategies or tools do you use to continuously learn new technologies and stay current?",
            f"Why are you specifically interested in this {role} role and what value do you hope to bring to the team?",
            "Do you have any questions for us about the role, culture, or technical roadmap?"
        ]

        # Retrieve RAG context if session is provided.
        # Query using the candidate's last answer transcript (richer signal than the question text)
        # so we surface resume chunks closest to what they actually discussed.
        rag_context_str = ""
        if session_id:
            try:
                from backend.services.rag_service import rag_service
                if turns_history:
                    last_turn = turns_history[-1]
                    # Blend last question + last answer for best semantic coverage
                    last_answer = last_turn.get("transcript", "").strip()
                    last_q = last_turn.get("questionText", "").strip()
                    query_term = f"{last_q} {last_answer}".strip() or role
                else:
                    query_term = role
                retrieved = rag_service.query_context(session_id, query=query_term, top_k=3)
                if retrieved:
                    rag_context_str = "\n".join([f"- {text[:300]}" for text in retrieved])
            except Exception as e:
                logger.debug(f"Failed to query RAG context in QuestionService: {e}")

        history_summary = ""
        for t in turns_history:
            q = t.get("questionText", "")
            ans = t.get("transcript", "")
            history_summary += f"Q: {q}\nA: {ans}\n\n"

        prompt = f"""You are an experienced technical interviewer interviewing a candidate for the role of '{role}'.
This is Question {question_index} of {total_questions}.

Context:
Candidate Resume Summary: {resume_text[:2000] if resume_text else 'None provided'}
Job Description Requirements: {job_desc_text[:2000] if job_desc_text else 'Standard ' + role + ' expectations'}

Retrieved Relevant Resume & Job Chunks (RAG):
{rag_context_str if rag_context_str else 'No specific matching context found.'}

Previous Q&A Conversation so far:
{history_summary if history_summary else 'This is the first question.'}

Instructions:
1. Generate the next realistic, engaging, and relevant interview question.
2. If question 1, start with an icebreaker / background walkthrough relevant to their resume/role.
3. If midway, dive into technical depth, design choices, or problem solving.
4. If nearing the end, assess behavioral, collaboration, or closing questions.
5. Keep the question brief, clear, and direct.
6. Return ONLY the question text directly without markdown quotes or conversational prefixes.
"""
        generated = cls._call_gemini(prompt)
        if generated:
            return generated

        idx = min(question_index - 1, len(fallback_questions) - 1)
        return fallback_questions[max(0, idx)]
