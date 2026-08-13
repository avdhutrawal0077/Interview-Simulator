import React from 'react';
import {
  SessionSummaryExport,
  SessionFullExport,
  Message,
} from '../types/interview';
import { downloadJson } from '../utils/sessionStorage';

interface ExportButtonsProps {
  sessionId: string;
  role: string;
  date: string;
  overallScore: number;
  questionsCompleted: number;
  totalQuestions: number;
  elapsedTime: string;
  messages: Message[];
}

export const ExportButtons: React.FC<ExportButtonsProps> = ({
  sessionId,
  role,
  date,
  overallScore,
  questionsCompleted,
  totalQuestions,
  elapsedTime,
  messages,
}) => {
  const handleSaveSummary = () => {
    // Build key takeaways from AI insights
    const takeaways = messages
      .filter((m) => m.role === 'ai' && m.insight)
      .map((m) => m.insight!)
      .slice(0, 8);

    // If no insights, add placeholder takeaways
    const finalTakeaways =
      takeaways.length > 0
        ? takeaways
        : [
            `Completed ${questionsCompleted} of ${totalQuestions} questions`,
            `Session duration: ${elapsedTime}`,
            `Role: ${role}`,
          ];

    const summary: SessionSummaryExport = {
      sessionId,
      role: role as SessionSummaryExport['role'],
      date,
      overallScore,
      keyTakeaways: finalTakeaways,
    };

    downloadJson(summary, `gethired-summary-${sessionId}.json`);
  };

  const handleSaveFullReport = () => {
    const fullExport: SessionFullExport = {
      sessionId,
      role: role as SessionFullExport['role'],
      date,
      overallScore,
      questionsCompleted,
      totalQuestions,
      elapsedTime,
      messages,
    };

    downloadJson(fullExport, `gethired-full-${sessionId}.json`);
  };

  return (
    <div className="flex gap-2 w-full">
      <button
        type="button"
        onClick={handleSaveSummary}
        className="flex-1 py-2.5 px-3 bg-[#2C2C2E] border border-[#3A3A3C] rounded-button text-[#F5F5F7] text-[13px] font-medium hover:bg-[#343539] transition-colors flex items-center justify-center gap-2 min-h-[44px] cursor-pointer"
      >
        <span className="material-symbols-outlined text-[16px] text-[#8E8E93]">
          summarize
        </span>
        Save Summary
      </button>
      <button
        type="button"
        onClick={handleSaveFullReport}
        className="flex-1 py-2.5 px-3 bg-[#2C2C2E] border border-[#3A3A3C] rounded-button text-[#F5F5F7] text-[13px] font-medium hover:bg-[#343539] transition-colors flex items-center justify-center gap-2 min-h-[44px] cursor-pointer"
      >
        <span className="material-symbols-outlined text-[16px] text-[#8E8E93]">
          download
        </span>
        Save Full Report
      </button>
    </div>
  );
};
