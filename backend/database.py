from typing import Dict, Any, Optional
import time

class InMemorySessionStore:
    """Ephemeral session store for active interview sessions."""
    def __init__(self):
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def create_session(self, session_id: str, candidate_name: str, job_title: str, role: str, total_questions: int = 8) -> Dict[str, Any]:
        session_data = {
            "sessionId": session_id,
            "candidateName": candidate_name,
            "jobTitle": job_title,
            "role": role,
            "startedAt": time.time(),
            "endedAt": None,
            "currentQuestionIndex": 0,
            "totalQuestions": total_questions or 8,
            "resumeText": "",
            "parsedResume": {},
            "jobDescriptionText": "",
            "parsedJD": {},
            "turns": [],
            "completed": False,
        }
        self._sessions[session_id] = session_data
        return session_data

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self._sessions.get(session_id)

    def update_session(self, session_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self.get_session(session_id)
        if session:
            session.update(updates)
        return session

    def add_turn(self, session_id: str, turn_data: Dict[str, Any]) -> bool:
        session = self.get_session(session_id)
        if session:
            session["turns"].append(turn_data)
            return True
        return False

# Global instance
session_store = InMemorySessionStore()
