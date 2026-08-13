import React from 'react';
import { Message, SphereState } from '../types/interview';
import { InterviewStage } from './InterviewStage';
import { TranscriptPanel } from './TranscriptPanel';

interface InterviewShellProps {
  questionIndex: number;
  totalQuestions: number;
  appName?: string;
  pacingStatus?: string;
  elapsedTime?: string;
  messages: Message[];
  isListening: boolean;
  isFullScreen?: boolean;
  onToggleListening?: () => void;
  onRefreshMessage?: (id: string) => void;
  onEndInterview?: () => void;
  sphereState?: SphereState;
  audioLevel?: number;
}

export const InterviewShell: React.FC<InterviewShellProps> = ({
  questionIndex,
  totalQuestions,
  appName = 'GetHired',
  pacingStatus = 'Good Pacing',
  elapsedTime = '00:15:24',
  messages,
  isListening,
  isFullScreen = true,
  onToggleListening,
  onRefreshMessage,
  onEndInterview,
  sphereState = 'idle',
  audioLevel = 0,
}) => {
  const progressPercentage = Math.min(
    100,
    Math.max(0, (questionIndex / totalQuestions) * 100)
  );

  return (
    <main
      className={
        isFullScreen
          ? "w-full h-screen min-h-screen flex flex-col md:flex-row overflow-hidden relative bg-[#1C1C1E]"
          : "w-full max-w-[1200px] h-[85vh] min-h-[600px] app-card rounded-[24px] flex flex-col md:flex-row overflow-hidden relative shadow-2xl"
      }
    >
      {/* Top Progress Bar + Question Label (Positioned absolutely over both columns) */}
      <div className="absolute top-0 left-0 w-full z-20 flex flex-col">
        <div className="w-full h-1 bg-[#2C2C2E]">
          <div
            className="h-full bg-[#F5F5F7] transition-all duration-300 ease-out"
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <div className="px-6 pt-1 flex justify-between items-center">
          <span className="text-[#8E8E93] text-[10px] font-medium uppercase tracking-widest">
            Question {questionIndex} of {totalQuestions}
          </span>
        </div>
      </div>

      {/* Left Column: Primary Interaction (InterviewStage) */}
      <InterviewStage
        appName={appName}
        pacingStatus={pacingStatus}
        elapsedTime={elapsedTime}
        onEndInterview={onEndInterview}
        sphereState={sphereState}
        audioLevel={audioLevel}
      />

      {/* Hairline Vertical Divider */}
      <div className="hidden md:block hairline-vertical h-full z-10 relative" />

      {/* Right Column: Context / Transcript (TranscriptPanel) */}
      <TranscriptPanel
        messages={messages}
        isListening={isListening}
        onToggleListening={onToggleListening}
        onRefreshMessage={onRefreshMessage}
      />
    </main>
  );
};
