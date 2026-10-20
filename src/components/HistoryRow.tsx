import React, { useState } from 'react';
import { SessionSummary } from '../types/interview';

interface HistoryRowProps {
  session: SessionSummary;
  isSelected?: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function scoreColor(score: number): string {
  if (score >= 70) return '#30D158';
  if (score >= 45) return '#FFD60A';
  return '#FF453A';
}

export const HistoryRow: React.FC<HistoryRowProps> = ({ session, isSelected, onClick, onDelete }) => {
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className={`history-row group w-full flex items-center gap-1 rounded-lg transition-colors ${
        isSelected ? 'bg-[#2C2C2E] border border-[#3A3A3C]' : 'hover:bg-[#1E1F23]'
      }`}
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      {/* Main clickable area */}
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer select-none"
      >
        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 border ${
          isSelected ? 'bg-[#3A3A3C] border-[#8E8E93]/40' : 'bg-[#2C2C2E]/60 border-[#3A3A3C]/40'
        }`}>
          <span className="material-symbols-outlined text-[12px] text-[#8E8E93]">description</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[#F5F5F7] text-[11px] font-medium truncate">{formatDate(session.date)}</p>
          <p className="text-[#636366] text-[9px]">{session.questionsCompleted}/{session.totalQuestions} questions</p>
        </div>
        <div
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-full shrink-0"
          style={{ backgroundColor: `${scoreColor(session.overallScore)}1F` }}
        >
          <span className="text-[10px] font-semibold" style={{ color: scoreColor(session.overallScore) }}>
            {session.overallScore}%
          </span>
        </div>
      </button>

      {/* Delete button — only visible on hover */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="Delete this report"
        className={`shrink-0 w-6 h-6 mr-1.5 rounded flex items-center justify-center transition-all cursor-pointer ${
          showDelete ? 'opacity-100 hover:bg-[#FF453A]/20' : 'opacity-0 pointer-events-none'
        }`}
      >
        <span className="material-symbols-outlined text-[14px] text-[#FF453A]">delete</span>
      </button>
    </div>
  );
};
