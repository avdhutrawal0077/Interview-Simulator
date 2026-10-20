from fastapi import APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks
from backend.models.schemas import ParsedResumeResponse, ParsedJobResponse
from backend.services.resume_service import ResumeParserService
from backend.services.rag_service import rag_service
from backend.database import session_store
from backend.utils import logger

router = APIRouter(tags=["Resume & Job"])


# ─── Text Chunking Utility ────────────────────────────────────────────────────

def chunk_text(text: str, chunk_size: int = 500, overlap: int = 80) -> list[str]:
    """
    Split text into overlapping fixed-size character windows.

    Args:
        text:       Full text to split.
        chunk_size: Max characters per chunk.
        overlap:    Characters shared between consecutive chunks for context continuity.

    Returns:
        List of non-empty text chunks, each >= 30 characters.
    """
    text = text.strip()
    if not text:
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()
        if len(chunk) >= 30:
            chunks.append(chunk)
        start += chunk_size - overlap
    return chunks


# ─── Background worker: parse + index resume after response is sent ────────────

def _parse_and_index_resume(session_id: str, raw_text: str) -> None:
    """
    Runs off the critical HTTP path — fires after the upload response is sent.

    Steps:
      1. Parse resume structure with Gemini (name, skills, experience).
      2. Update session with parsed data and candidate name.
      3. Index raw text chunks into ChromaDB for semantic retrieval.
      4. Extract structured interview-relevant features and index as feature documents.
    """
    session = session_store.get_session(session_id)
    role = (session or {}).get("role", "Software Engineer")

    # Step 1: Structured parse
    parsed_data: dict = {}
    try:
        parsed_data = ResumeParserService.parse_resume_to_structure(raw_text)
        updates: dict = {"parsedResume": parsed_data}

        # Update candidate name if not already set
        if session:
            existing_name = session.get("candidateName", "").strip()
            resume_name = parsed_data.get("name", "").strip()
            if resume_name and (not existing_name or existing_name.lower() == "candidate"):
                updates["candidateName"] = resume_name
                logger.info(f"[BG Resume] Updated candidateName to '{resume_name}' from parsed resume")

        session_store.update_session(session_id, updates)
        logger.info(f"[BG Resume] Gemini parse complete for session {session_id}")
    except Exception as e:
        logger.warning(f"[BG Resume] Gemini parse failed (non-fatal): {e}")

    # Step 2: Index raw text chunks
    try:
        chunks = chunk_text(raw_text)
        if chunks:
            rag_service.add_documents(
                session_id=session_id,
                texts=chunks,
                metadatas=[{"type": "resume", "chunk_idx": i} for i in range(len(chunks))]
            )
            logger.info(f"[BG Resume] Indexed {len(chunks)} raw chunks for session {session_id}")
    except Exception as e:
        logger.warning(f"[BG Resume] ChromaDB raw chunk indexing failed (non-fatal): {e}")

    # Step 3: Extract and index structured feature documents
    try:
        feature_docs = ResumeParserService.extract_rag_features(raw_text, role=role)
        if feature_docs:
            for feat in feature_docs:
                rag_service.add_feature_document(
                    session_id=session_id,
                    feature_text=feat,
                    doc_type="resume_feature",
                    extra_meta={"role": role},
                )
            logger.info(f"[BG Resume] Indexed {len(feature_docs)} resume feature docs for session {session_id}")
    except Exception as e:
        logger.warning(f"[BG Resume] Feature extraction/indexing failed (non-fatal): {e}")


# ─── Resume Upload ────────────────────────────────────────────────────────────

@router.post("/resume/upload", response_model=ParsedResumeResponse)
async def upload_resume(
    file: UploadFile = File(...),
    sessionId: str = Form(...),
    background_tasks: BackgroundTasks = None,
):
    session = session_store.get_session(sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        content = await file.read()
        # Step 1: fast synchronous PDF text extraction (no Gemini, instant)
        raw_text = ResumeParserService.extract_text_from_pdf(content)

        # Step 2: store raw text immediately so QuestionService can use it
        session_store.update_session(sessionId, {"resumeText": raw_text})

        # Step 3: fire Gemini parsing + RAG indexing in background (non-blocking)
        if background_tasks is not None:
            background_tasks.add_task(_parse_and_index_resume, sessionId, raw_text)
        else:
            # Sync fallback if background tasks unavailable (rare)
            _parse_and_index_resume(sessionId, raw_text)

        logger.info(f"[Resume] PDF extracted instantly; parse+index sent to background for session {sessionId}")

        # Return immediately with raw text as a minimal parsed structure
        quick_parsed = {
            "fileName": file.filename,
            "size": len(content),
            "rawTextLength": len(raw_text),
            "summary": raw_text[:300].strip() if raw_text else "",
        }
        return ParsedResumeResponse(parsedResume=quick_parsed)
    except Exception as e:
        logger.error(f"Failed to extract resume: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to process resume: {str(e)}")


# ─── Job Description Upload ───────────────────────────────────────────────────

@router.post("/job/upload", response_model=ParsedJobResponse)
async def upload_job(
    file: UploadFile = File(...),
    sessionId: str = Form(...),
):
    session = session_store.get_session(sessionId)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        content = await file.read()
        raw_text = ResumeParserService.extract_text_from_pdf(content)
        parsed_data = {
            "rawText": raw_text,
            "role": session.get("role", "Software Engineer"),
            "requirements": [line.strip() for line in raw_text.splitlines() if line.strip()][:10]
        }

        # Index fixed-size overlapping chunks for high-quality RAG retrieval
        chunks = chunk_text(raw_text)
        if chunks:
            rag_service.add_documents(
                session_id=sessionId,
                texts=chunks,
                metadatas=[{"type": "job_description", "chunk_idx": i} for i in range(len(chunks))]
            )
            logger.info(f"Indexed {len(chunks)} JD chunks into ChromaDB for session {sessionId}")

        session_store.update_session(sessionId, {
            "jobDescriptionText": raw_text,
            "parsedJD": parsed_data
        })
        logger.info(f"Successfully parsed & indexed job description for session: {sessionId}")
        return ParsedJobResponse(parsedJD=parsed_data)
    except Exception as e:
        logger.error(f"Failed to parse job description: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to process job description: {str(e)}")
