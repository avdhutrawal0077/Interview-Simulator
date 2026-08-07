export type Role = 'ai' | 'user';

/** Visual state for the InterviewSphere orb */
export type SphereState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface Message {
  id: string;
  role: Role;
  text: string;
  insight?: string;
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

/** Lightweight session summary for history sidebar */
export interface SessionSummary {
  sessionId: string;
  role: JobRole;
  date: string;           // ISO 8601
  overallScore: number;   // 0–100
  questionsCompleted: number;
  totalQuestions: number;
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
}
