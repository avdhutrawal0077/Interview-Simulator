import asyncio
from fastapi import APIRouter, HTTPException, BackgroundTasks
from backend.models.schemas import (
    GetQuestionRequest,
    QuestionResponse,
    SubmitAnswerRequest,
    SubmitAnswerResponse,
    ScoreBreakdown,
    NextQuestionData,
    FinalReportRequest,
    FinalReportResponse,
)
from backend.database import session_store
from backend.services.question_service import QuestionService
from backend.services.evaluation_service import EvaluationService
from backend.utils import logger

router = APIRouter(prefix="/interview", tags=["Interview"])


# ─── Background Evaluation + Feature Extraction Task ─────────────────────────

def _run_evaluation_background(
    session_id: str,
    turn_id: int,
    role: str,
    question_text: str,
    transcript: str,
    eye_contact: float,
    blink_rate: float,
    head_stability: float,
    prior_turns: list = None,
) -> None:
    """
    Run Gemini evaluation + answer feature extraction off the critical path.

    Called by FastAPI BackgroundTasks after the HTTP response is already sent —
    the candidate gets their next question immediately while this:
      1. Scores the previous answer (evaluate_answer)
      2. Extracts answer features (extract_answer_features) → indexes into RAG
      3. Patches the turn record with real scores
    """
    try:
        eval_result = EvaluationService.evaluate_answer(
            role=role,
            question_text=question_text,
            transcript=transcript,
            eye_contact=eye_contact,
            blink_rate=blink_rate,
            head_stability=head_stability,
            prior_turns=prior_turns or [],
        )
        scores = eval_result.get("scores", {"technical": 3, "communication": 3, "confidence": 3})
        feedback = eval_result.get("feedback", "Evaluation could not be completed — please try again.")

        # Patch the already-recorded turn with real scores
        session = session_store.get_session(session_id)
        if session:
            turns = session.get("turns", [])
            for turn in turns:
                if turn.get("turnId") == turn_id:
                    turn["scores"] = scores
                    turn["feedback"] = feedback
                    turn["evalPending"] = False   # mark as resolved
                    break
            session_store.update_session(session_id, {"turns": turns})
            logger.info(
                f"[BG Eval] Turn {turn_id} scored — "
                f"technical={scores.get('technical')}, "
                f"communication={scores.get('communication')}, "
                f"confidence={scores.get('confidence')}"
            )
    except Exception as e:
        logger.error(f"[BG Eval] Background evaluation failed for turn {turn_id}: {e}")
        scores = {"technical": 3, "communication": 3, "confidence": 3}
        # Mark as resolved even on failure to unblock report synthesis
        try:
            session = session_store.get_session(session_id)
            if session:
                turns = session.get("turns", [])
                for turn in turns:
                    if turn.get("turnId") == turn_id:
                        turn["evalPending"] = False
                        break
                session_store.update_session(session_id, {"turns": turns})
        except Exception:
            pass

    # ── Extract answer features and store in RAG (non-critical) ──────────────
    try:
        feature_doc = EvaluationService.extract_answer_features(
            role=role,
            question_text=question_text,
            transcript=transcript,
            turn_id=turn_id,
            scores=scores,
        )
        if feature_doc:
            from backend.services.rag_service import rag_service
            rag_service.add_feature_document(
                session_id=session_id,
                feature_text=feature_doc,
                doc_type="answer_insight",
                extra_meta={"turn_id": turn_id},
            )
            logger.info(f"[BG Eval] Answer features indexed for turn {turn_id}")
    except Exception as e:
        logger.debug(f"[BG Eval] Answer feature indexing skipped for turn {turn_id}: {e}")


# ─── Get Next Question ────────────────────────────────────────────────────────

@router.post("/question", response_model=QuestionResponse)
async def get_question(req: GetQuestionRequest):
    session = session_store.get_session(req.sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    next_idx = session.get("currentQuestionIndex", 0) + 1
    total_q = session.get("totalQuestions", 8)
    role = session.get("role", "Software Engineer")
    resume_text = session.get("resumeText", "")
    job_desc = session.get("jobDescriptionText", "")
    turns = session.get("turns", [])

    try:
        q_text = await asyncio.wait_for(
            asyncio.to_thread(
                QuestionService.generate_next_question,
                role=role,
                question_index=next_idx,
                total_questions=total_q,
                resume_text=resume_text,
                job_desc_text=job_desc,
                turns_history=turns,
                session_id=req.sessionId,
            ),
            timeout=15.0,  # never block client >15s; fallback question fires automatically
        )
    except asyncio.TimeoutError:
        logger.warning(f"[Question] Gemini timed out for session {req.sessionId}, using fallback")
        fallbacks = [
            "Could you start by introducing yourself and highlighting your key background?",
            "Tell me about the most technically challenging project you've worked on recently.",
            "How do you approach debugging and root-cause analysis in production?",
        ]
        q_text = fallbacks[(next_idx - 1) % len(fallbacks)]

    session_store.update_session(req.sessionId, {"currentQuestionIndex": next_idx})
    logger.info(f"Generated question #{next_idx} for session {req.sessionId}")

    return QuestionResponse(
        questionId=next_idx,
        questionText=q_text,
        totalQuestions=total_q,
    )


# ─── Submit Answer (Async Eval + Instant Next Question) ───────────────────────

@router.post("/answer", response_model=SubmitAnswerResponse)
async def submit_answer(req: SubmitAnswerRequest, background_tasks: BackgroundTasks):
    session = session_store.get_session(req.sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    role = session.get("role", "Software Engineer")
    total_q = session.get("totalQuestions", 8)
    curr_idx = req.questionId

    # Resolve the question text that was just answered
    last_turn_text = f"Question {curr_idx}"
    if session.get("turns"):
        last_turn_text = session["turns"][-1].get("questionText", last_turn_text)

    # Capture previous turns BEFORE adding the current turn (so eval context is prior history only)
    prior_turns = list(session.get("turns", []))

    # ── Step 1: Record turn immediately with placeholder scores ───────────────
    placeholder_scores = {"technical": 0, "communication": 0, "confidence": 0}
    turn_record = {
        "turnId": curr_idx,
        "questionText": last_turn_text,
        "transcript": req.transcript,
        "bodyLanguageMetrics": {
            "eyeContact": req.eyeContact,
            "blinkRate": req.blinkRate,
            "headStability": req.headStability,
        },
        "scores": placeholder_scores,
        "feedback": "Evaluating…",
        "evalPending": True,
    }
    session_store.add_turn(req.sessionId, turn_record)

    # ── Step 2: Kick off Gemini evaluation + feature extraction off critical path ──
    background_tasks.add_task(
        _run_evaluation_background,
        session_id=req.sessionId,
        turn_id=curr_idx,
        role=role,
        question_text=last_turn_text,
        transcript=req.transcript,
        eye_contact=req.eyeContact or 80.0,
        blink_rate=req.blinkRate or 15.0,
        head_stability=req.headStability or 85.0,
        prior_turns=prior_turns,   # previous turns only, not current
    )

    # ── Step 3: Handle interview completion ────────────────────────────────────
    if curr_idx >= total_q:
        session_store.update_session(req.sessionId, {"completed": True, "sessionId": req.sessionId})
        logger.info(f"Interview complete for session {req.sessionId}. Background evals flushing…")
        return SubmitAnswerResponse(
            scores=ScoreBreakdown(**placeholder_scores),
            feedback="Interview complete! Generating your report…",
            nextQuestion=None,
            isComplete=True,
        )

    # ── Step 4: Generate next question immediately (no waiting for eval) ───────
    next_idx = curr_idx + 1
    try:
        next_q_text = await asyncio.wait_for(
            asyncio.to_thread(
                QuestionService.generate_next_question,
                role=role,
                question_index=next_idx,
                total_questions=total_q,
                resume_text=session.get("resumeText", ""),
                job_desc_text=session.get("jobDescriptionText", ""),
                turns_history=session.get("turns", []),
                session_id=req.sessionId,
            ),
            timeout=15.0,
        )
    except asyncio.TimeoutError:
        logger.warning(f"[Answer] Question generation timed out; using fallback for turn {next_idx}")
        fallbacks = [
            "Can you walk me through a challenging technical problem you solved recently?",
            "How do you ensure code quality and maintainability in your projects?",
            "Tell me about a time you had to make a trade-off between speed and quality.",
            "How do you stay up to date with new technologies in your field?",
        ]
        next_q_text = fallbacks[(next_idx - 1) % len(fallbacks)]
    session_store.update_session(req.sessionId, {"currentQuestionIndex": next_idx})
    logger.info(f"[Latency Masking] Next question #{next_idx} ready; evaluation running in background.")

    return SubmitAnswerResponse(
        scores=ScoreBreakdown(**placeholder_scores),
        feedback="Evaluating your answer…",
        nextQuestion=NextQuestionData(questionId=next_idx, questionText=next_q_text),
        isComplete=False,
    )


# ─── Final Report Synthesis ───────────────────────────────────────────────────

@router.post("/report", response_model=FinalReportResponse)
async def generate_report(req: FinalReportRequest):
    """
    Synthesize the final AI debrief report for a completed interview session.

    Flow:
      1. Validate session exists and is marked completed.
      2. Call EvaluationService.synthesize_final_report() which:
           - Waits up to 10s for any pending background evaluations to flush.
           - Uses accumulated RAG session memory (resume features + answer insights).
           - Aggregates per-turn scores into overall + body-language metrics.
           - Calls Gemini to generate strengths, improvements, narrative, skill gaps.
      3. Destroy the ephemeral ChromaDB vector index (zero-persistence guarantee).
      4. Return structured FinalReportResponse.
    """
    session = session_store.get_session(req.sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.get("completed"):
        raise HTTPException(
            status_code=400,
            detail="Interview is not yet complete. Submit all answers before requesting the report."
        )

    # Inject sessionId so synthesize_final_report can fetch RAG memory
    session["sessionId"] = req.sessionId

    logger.info(f"[Report] Synthesizing final report for session {req.sessionId}…")

    try:
        report_data = EvaluationService.synthesize_final_report(session)
    except Exception as e:
        logger.error(f"[Report] Synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Report synthesis failed: {str(e)}")

    # ── Enforce zero-persistence: destroy ephemeral ChromaDB vectors ──────────
    try:
        from backend.services.rag_service import rag_service
        rag_service.delete_session_collection(req.sessionId)
        logger.info(f"[Report] Ephemeral ChromaDB collection deleted for session {req.sessionId}")
    except Exception as e:
        logger.debug(f"[Report] ChromaDB cleanup skipped or failed: {e}")

    return FinalReportResponse(**report_data)
