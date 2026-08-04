export type Role = 'ai' | 'user';

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
