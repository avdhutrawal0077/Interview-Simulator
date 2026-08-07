import React from 'react';
import { SessionSummary } from '../types/interview';
import { HistoryRow } from './HistoryRow';

interface HistorySidebarProps {
  history: SessionSummary[];
  onSelectSession: (sessionId: string) => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  history,
  onSelectSession,
}) => {
  return (
    <aside className="w-[280px] h-full bg-sidebar border-r border-[#2C2C2E] flex flex-col shrink-0 select-none hidden md:flex">
      {/* Top: Logo */}
      <div className="px-5 py-5 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-[10px] bg-[#F5F5F7] flex items-center justify-center">
          <span className="text-[#0A0A0A] text-[14px] font-bold">G</span>
        </div>
        <span className="text-[#F5F5F7] text-[16px] font-semibold tracking-tight">
          GetHired
        </span>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-[#2C2C2E]" />

      {/* Middle: History list */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 py-3">
          <span className="text-[#8E8E93] text-[11px] font-medium uppercase tracking-widest">
            History
          </span>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {history.length === 0 ? (
            <div className="px-5 py-8 flex flex-col items-center text-center">
              <span className="material-symbols-outlined text-[28px] text-[#3A3A3C] mb-2">
                history
              </span>
              <p className="text-[#8E8E93] text-[12px] leading-relaxed">
                Your past sessions<br />will appear here
              </p>
            </div>
          ) : (
            history.map((session) => (
              <HistoryRow
                key={session.sessionId}
                session={session}
                onClick={() => onSelectSession(session.sessionId)}
              />
            ))
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="w-full h-px bg-[#2C2C2E]" />

      {/* Bottom: Account row */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-[#2C2C2E] border border-[#3A3A3C] flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[16px] text-[#8E8E93]">
            person
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[#F5F5F7] text-[13px] font-medium truncate">
            Guest User
          </p>
        </div>
        <button
          type="button"
          className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#2C2C2E] transition-colors cursor-pointer"
          aria-label="Settings"
        >
          <span className="material-symbols-outlined text-[18px] text-[#8E8E93]">
            settings
          </span>
        </button>
      </div>
    </aside>
  );
};
