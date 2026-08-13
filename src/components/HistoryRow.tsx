import React from 'react';
import { SessionSummary } from '../types/interview';

interface HistoryRowProps {
  session: SessionSummary;
  isSelected?: boolean;
  onClick: () => void;
}

/** Format ISO date to short readable form */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/** Score color based on value */
function scoreColor(score: number): string {
  if (score >= 80) return '#30D158';
  if (score >= 60) return '#FFD60A';
  return '#FF453A';
}

export const HistoryRow: React.FC<HistoryRowProps> = ({ session, isSelected, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`history-row w-full text-left px-3 py-2.5 flex items-center gap-2.5 rounded-lg transition-colors cursor-pointer select-none ${
        isSelected
          ? 'bg-[#2C2C2E] border border-[#3A3A3C]'
          : 'hover:bg-[#1E1F23]'
      }`}
    >
      {/* Session indicator icon */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 border ${
        isSelected ? 'bg-[#3A3A3C] border-[#8E8E93]/40' : 'bg-[#2C2C2E]/60 border-[#3A3A3C]/40'
      }`}>
        <span className="material-symbols-outlined text-[13px] text-[#8E8E93]">
          description
        </span>
      </div>

      {/* Date */}
      <div className="flex-1 min-w-0">
        <p className="text-[#F5F5F7] text-[12px] font-medium truncate">
          {formatDate(session.date)}
        </p>
      </div>

      {/* Score chip */}
      <div
        className="flex items-center gap-1 px-2 py-0.5 rounded-full shrink-0"
        style={{ backgroundColor: `${scoreColor(session.overallScore)}1F` }}
      >
        <span
          className="text-[11px] font-semibold"
          style={{ color: scoreColor(session.overallScore) }}
        >
          {session.overallScore}%
        </span>
      </div>
    </button>
  );
};
