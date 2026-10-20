export type Role = 'ai' | 'user';

/** Visual state for the InterviewSphere orb */
export type SphereState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface TurnScores {
  technical: number;
  communication: number;
  confidence: number;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  insight?: string;
  turnScores?: TurnScores;
  isStreaming?: boolean;
  timestamp?: string;
}

export interface InterviewState {
  questionIndex: number;
  totalQuestions: number;
  messages: Message[];
  isListening: boolean;
  elapsedTime: string;
  pacingStatus: string;
  appName: string;
}

/** Available job roles for the interview simulation */
export type JobRole =
  | 'Software Engineer'
  | 'Data Scientist'
  | 'Frontend Engineer'
  | 'Backend Engineer'
  | 'ML Engineer'
  | 'Product Manager';

export const JOB_ROLES: JobRole[] = [
  'Software Engineer',
  'Data Scientist',
  'Frontend Engineer',
  'Backend Engineer',
  'ML Engineer',
  'Product Manager',
];

/** Category sub-scores breakdown for report analytics */
export interface CategoryScores {
  technical: number;
  communication: number;
  bodyLanguage: number;
  roleFit: number;
}

/** AI-generated debrief payload from the backend synthesis endpoint */
export interface AiDebrief {
  overall_scores: {
    technical: number;
    communication: number;
    confidence: number;
    role_fit: number;
  };
  body_language: {
    eye_contact: number;
    blink_rate: number;
    head_stability: number;
  };
  strengths: string[];
  improvements: string[];
  debrief_narrative: string;
  hiring_recommendation: string;
  skill_gaps?: string[];
  topic_coverage?: {
    covered_well?: string[];
    needs_improvement?: string[];
  };
  turns?: Array<{
    turnId: number;
    questionText: string;
    transcript: string;
    scores: { technical: number; communication: number; confidence: number };
    feedback: string;
    bodyLanguageMetrics?: { eyeContact?: number; blinkRate?: number; headStability?: number };
  }>;
}

/** Lightweight session summary for history sidebar */
export interface SessionSummary {
  sessionId: string;
  role: JobRole;
  date: string;           // ISO 8601
  overallScore: number;   // 0–100
  questionsCompleted: number;
  totalQuestions: number;
  categoryScores?: CategoryScores;
  aiDebrief?: AiDebrief;
}

/** Shape for "Save Summary" JSON export */
export interface SessionSummaryExport {
  sessionId: string;
  role: JobRole;
  date: string;
  overallScore: number;
  keyTakeaways: string[];
}

/** Shape for "Save Full Report" JSON export */
export interface SessionFullExport {
  sessionId: string;
  role: JobRole;
  date: string;
  overallScore: number;
  questionsCompleted: number;
  totalQuestions: number;
  elapsedTime: string;
  messages: Message[];
  categoryScores?: CategoryScores;
  /** AI-synthesized debrief — populated when the backend /report endpoint succeeds */
  aiDebrief?: AiDebrief;
}
