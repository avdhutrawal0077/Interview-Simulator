import React from 'react';
import { SessionSummary } from '../types/interview';

interface HistoryRowProps {
  session: SessionSummary;
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

export const HistoryRow: React.FC<HistoryRowProps> = ({ session, onClick }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className="history-row w-full text-left px-4 py-3 flex items-center gap-3 border-b border-[#2C2C2E]/50 cursor-pointer select-none"
    >
      {/* Role icon */}
      <div className="w-8 h-8 rounded-full bg-[#2C2C2E] border border-[#3A3A3C] flex items-center justify-center shrink-0">
        <span className="material-symbols-outlined text-[14px] text-[#8E8E93]">
          work
        </span>
      </div>

      {/* Role + date */}
      <div className="flex-1 min-w-0">
        <p className="text-[#F5F5F7] text-[13px] font-medium truncate">
          {session.role}
        </p>
        <p className="text-[#8E8E93] text-[11px] mt-0.5">
          {formatDate(session.date)}
        </p>
      </div>

      {/* Score chip */}
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full shrink-0"
        style={{ backgroundColor: `${scoreColor(session.overallScore)}20` }}
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
