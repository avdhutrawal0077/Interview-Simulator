from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

# Session Models
class StartSessionRequest(BaseModel):
    candidateName: Optional[str] = "Candidate"
    jobTitle: Optional[str] = "Software Engineer"
    role: Optional[str] = "Software Engineer"
    totalQuestions: Optional[int] = 8

class StartSessionResponse(BaseModel):
    sessionId: str

class SessionStatusResponse(BaseModel):
    sessionId: str
    completed: bool
    answeredCount: int
    totalQuestions: int

# Resume & Job Parsing Models
class ParsedResumeResponse(BaseModel):
    parsedResume: Dict[str, Any]

class ParsedJobResponse(BaseModel):
    parsedJD: Dict[str, Any]

# Interview Flow Models
class GetQuestionRequest(BaseModel):
    sessionId: str

class QuestionResponse(BaseModel):
    questionId: int
    questionText: str
    totalQuestions: Optional[int] = 8

class BodyLanguageMetrics(BaseModel):
    eyeContact: Optional[float] = Field(default=80.0, description="Eye contact percentage 0-100")
    blinkRate: Optional[float] = Field(default=15.0, description="Blinks per minute")
    headStability: Optional[float] = Field(default=85.0, description="Head stability percentage 0-100")

class SubmitAnswerRequest(BaseModel):
    sessionId: str
    questionId: int
    transcript: str
    eyeContact: Optional[float] = 80.0
    blinkRate: Optional[float] = 15.0
    headStability: Optional[float] = 85.0

class ScoreBreakdown(BaseModel):
    technical: int = Field(ge=0, le=10)
    communication: int = Field(ge=0, le=10)
    confidence: int = Field(ge=0, le=10)

class NextQuestionData(BaseModel):
    questionId: int
    questionText: str

class SubmitAnswerResponse(BaseModel):
    scores: ScoreBreakdown
    feedback: str
    nextQuestion: Optional[NextQuestionData] = None
    isComplete: bool = False

# ─── Final Report Models ──────────────────────────────────────────────────────

class FinalReportRequest(BaseModel):
    sessionId: str

class OverallScores(BaseModel):
    technical: float
    communication: float
    confidence: float
    role_fit: float

class AggregatedBodyLanguage(BaseModel):
    eye_contact: float
    blink_rate: float
    head_stability: float

class FinalReportResponse(BaseModel):
    overall_scores: OverallScores
    body_language: AggregatedBodyLanguage
    strengths: List[str]
    improvements: List[str]
    debrief_narrative: str
    hiring_recommendation: str
    turns: List[Dict[str, Any]]
    role: str
    total_questions: int
