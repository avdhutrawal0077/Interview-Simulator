// Empty string = relative URLs → works with Vite proxy (dev) and FastAPI serving dist (prod)
// Set VITE_API_URL to an explicit URL only when frontend and backend run on different domains.
export const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || '';

export interface StartSessionResponse {
  sessionId: string;
}

export interface QuestionResponse {
  questionId: number;
  questionText: string;
  totalQuestions?: number;
}

export interface ScoreBreakdown {
  technical: number;
  communication: number;
  confidence: number;
}

export interface NextQuestionData {
  questionId: number;
  questionText: string;
}

export interface SubmitAnswerResponse {
  scores: ScoreBreakdown;
  feedback: string;
  nextQuestion?: NextQuestionData | null;
  isComplete: boolean;
}

export interface ParsedResumeResponse {
  parsedResume: Record<string, any>;
}

export interface SessionStatusResponse {
  sessionId: string;
  completed: boolean;
  answeredCount: number;
  totalQuestions: number;
}

// ─── Final Report Types ───────────────────────────────────────────────────────

export interface OverallScores {
  technical: number;
  communication: number;
  confidence: number;
  role_fit: number;
}

export interface AggregatedBodyLanguage {
  eye_contact: number;
  blink_rate: number;
  head_stability: number;
}

export interface TurnRecord {
  turnId: number;
  questionText: string;
  transcript: string;
  bodyLanguageMetrics: {
    eyeContact: number | null;
    blinkRate: number | null;
    headStability: number | null;
  };
  scores: ScoreBreakdown;
  feedback: string;
}

export interface FinalReportResponse {
  overall_scores: OverallScores;
  body_language: AggregatedBodyLanguage;
  strengths: string[];
  improvements: string[];
  debrief_narrative: string;
  hiring_recommendation: string;
  turns: TurnRecord[];
  role: string;
  total_questions: number;
}

/**
 * API service for communicating with the FastAPI backend.
 * Falls back gracefully to local client behavior if backend is unreachable.
 */
export const api = {
  /** Create a new ephemeral interview session */
  async startSession(candidateName: string = 'Candidate', role: string = 'Software Engineer'): Promise<StartSessionResponse> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000); // 8s timeout
      const res = await fetch(`${API_BASE_URL}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateName, role, jobTitle: role }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn('Backend startSession failed, using offline session fallback:', error);
      return { sessionId: `local_${Date.now().toString(36)}` };
    }
  },

  /** Upload and parse resume PDF */
  async uploadResume(file: File, sessionId: string): Promise<ParsedResumeResponse> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sessionId', sessionId);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000); // 12s timeout
      const res = await fetch(`${API_BASE_URL}/resume/upload`, {
        method: 'POST',
        body: formData,
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn('Backend uploadResume failed, using offline fallback:', error);
      return { parsedResume: { fileName: file.name, size: file.size } };
    }
  },

  /** Fetch the next interview question */
  async getQuestion(sessionId: string): Promise<QuestionResponse> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000); // 10s timeout
      const res = await fetch(`${API_BASE_URL}/interview/question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn('Backend getQuestion failed, using fallback question:', error);
      return {
        questionId: 1,
        questionText: 'Could you please introduce yourself and walk through your technical experience relevant to this role?',
        totalQuestions: 8,
      };
    }
  },

  /** Submit candidate's answer and get evaluation & next question */
  async submitAnswer(params: {
    sessionId: string;
    questionId: number;
    transcript: string;
    eyeContact?: number;
    blinkRate?: number;
    headStability?: number;
  }): Promise<SubmitAnswerResponse> {
    try {
      const res = await fetch(`${API_BASE_URL}/interview/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: params.sessionId,
          questionId: params.questionId,
          transcript: params.transcript,
          eyeContact: params.eyeContact ?? 80,
          blinkRate: params.blinkRate ?? 15,
          headStability: params.headStability ?? 85,
        }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn('Backend submitAnswer failed, using offline evaluation fallback:', error);
      const isLast = params.questionId >= 8;
      return {
        scores: { technical: 8, communication: 8, confidence: 8 },
        feedback: 'Strong response structure and clear articulation.',
        nextQuestion: isLast ? null : {
          questionId: params.questionId + 1,
          questionText: 'Can you describe how you handle performance optimization in your technical projects?',
        },
        isComplete: isLast,
      };
    }
  },

  /** Synthesize the final AI debrief report for a completed session */
  async getFinalReport(sessionId: string): Promise<FinalReportResponse | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/interview/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn('Backend getFinalReport failed — report will use local scores only:', error);
      return null;
    }
  },

  /** Check current session status */
  async getSessionStatus(sessionId: string): Promise<SessionStatusResponse | null> {
    try {
      const res = await fetch(`${API_BASE_URL}/session/${sessionId}/status`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },
};
