import uuid
from fastapi import APIRouter, HTTPException
from backend.models.schemas import (
    StartSessionRequest,
    StartSessionResponse,
    SessionStatusResponse
)
from backend.database import session_store
from backend.utils import logger

router = APIRouter(prefix="/session", tags=["Session"])

@router.post("/start", response_model=StartSessionResponse)
async def start_session(req: StartSessionRequest):
    session_id = f"sess_{uuid.uuid4().hex[:10]}"
    role = req.role or req.jobTitle or "Software Engineer"
    candidate_name = req.candidateName or "Candidate"
    job_title = req.jobTitle or role

    session_store.create_session(
        session_id=session_id,
        candidate_name=candidate_name,
        job_title=job_title,
        role=role,
        total_questions=req.totalQuestions or 8
    )
    logger.info(f"Created interview session: {session_id} for role {role}")
    return StartSessionResponse(sessionId=session_id)

@router.get("/{session_id}/status", response_model=SessionStatusResponse)
async def get_session_status(session_id: str):
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    return SessionStatusResponse(
        sessionId=session_id,
        completed=session.get("completed", False),
        answeredCount=len(session.get("turns", [])),
        totalQuestions=session.get("totalQuestions", 8)
    )
