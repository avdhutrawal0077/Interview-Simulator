import React from 'react';
import { SessionFullExport } from '../types/interview';

interface ReportViewProps {
  session: SessionFullExport;
  onClose: () => void;
}

/** Format ISO date to readable form */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return '#30D158';
  if (score >= 60) return '#FFD60A';
  return '#FF453A';
}

export const ReportView: React.FC<ReportViewProps> = ({ session, onClose }) => {
  // Extract AI insights as takeaways
  const takeaways = session.messages
    .filter((m) => m.role === 'ai' && m.insight)
    .map((m) => m.insight!)
    .slice(0, 8);

  return (
    <div
      className="fixed inset-0 bg-[#0A0A0A]/80 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] p-8 max-w-lg w-full flex flex-col gap-5 shadow-2xl max-h-[80vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[20px] font-semibold text-[#F5F5F7]">
              Session Report
            </h3>
            <p className="text-[13px] text-[#8E8E93] mt-1">
              {formatDate(session.date)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#2C2C2E] border border-[#3A3A3C] flex items-center justify-center hover:bg-[#343539] transition-colors cursor-pointer"
            aria-label="Close report"
          >
            <span className="material-symbols-outlined text-[16px] text-[#8E8E93]">
              close
            </span>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-[#2C2C2E]/50 rounded-button p-3 text-center">
            <p
              className="text-[24px] font-bold"
              style={{ color: scoreColor(session.overallScore) }}
            >
              {session.overallScore}%
            </p>
            <p className="text-[11px] text-[#8E8E93] mt-1 uppercase tracking-wider font-medium">
              Score
            </p>
          </div>
          <div className="bg-[#2C2C2E]/50 rounded-button p-3 text-center">
            <p className="text-[24px] font-bold text-[#F5F5F7]">
              {session.questionsCompleted}/{session.totalQuestions}
            </p>
            <p className="text-[11px] text-[#8E8E93] mt-1 uppercase tracking-wider font-medium">
              Questions
            </p>
          </div>
          <div className="bg-[#2C2C2E]/50 rounded-button p-3 text-center">
            <p className="text-[24px] font-bold text-[#F5F5F7]">
              {session.elapsedTime}
            </p>
            <p className="text-[11px] text-[#8E8E93] mt-1 uppercase tracking-wider font-medium">
              Duration
            </p>
          </div>
        </div>

        {/* Role */}
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-[#8E8E93]">work</span>
          <span className="text-[14px] text-[#c5c7c9] font-medium">{session.role}</span>
        </div>

        {/* Takeaways */}
        {takeaways.length > 0 && (
          <div>
            <h4 className="text-[13px] text-[#8E8E93] font-medium uppercase tracking-wider mb-3">
              Key Insights
            </h4>
            <div className="flex flex-col gap-2">
              {takeaways.map((t, i) => (
                <div
                  key={i}
                  className="flex gap-2.5 items-start text-[13px] text-[#c5c7c9] leading-relaxed"
                >
                  <span className="text-[#3A3A3C] mt-0.5 shrink-0">•</span>
                  <span>{t}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transcript preview */}
        {session.messages.length > 0 && (
          <div>
            <h4 className="text-[13px] text-[#8E8E93] font-medium uppercase tracking-wider mb-3">
              Transcript ({session.messages.length} messages)
            </h4>
            <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto custom-scrollbar">
              {session.messages.slice(0, 20).map((msg) => (
                <div
                  key={msg.id}
                  className={`text-[12px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'text-[#F5F5F7] pl-4'
                      : 'text-[#8E8E93] border-l-2 border-[#3A3A3C] pl-3'
                  }`}
                >
                  <span className="text-[10px] uppercase tracking-widest font-medium block mb-0.5">
                    {msg.role === 'user' ? 'You' : 'Interviewer'}
                  </span>
                  <span className="line-clamp-2">{msg.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
