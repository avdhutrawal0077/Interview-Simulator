import React, { useState, useMemo, useEffect } from 'react';
import { SessionSummary } from '../types/interview';
import { HistoryRow } from './HistoryRow';

interface HistorySidebarProps {
  history: SessionSummary[];
  selectedSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onGoHome: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
  history,
  selectedSessionId,
  onSelectSession,
  onGoHome,
}) => {
  // Track open/collapsed state per role folder
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  // Group history by role dynamically
  const roleGroups = useMemo(() => {
    const groups: Record<string, SessionSummary[]> = {};
    history.forEach((session) => {
      if (!groups[session.role]) {
        groups[session.role] = [];
      }
      groups[session.role].push(session);
    });
    return groups;
  }, [history]);

  // If a session is selected, auto-expand its parent role folder
  useEffect(() => {
    if (selectedSessionId) {
      const activeSession = history.find((s) => s.sessionId === selectedSessionId);
      if (activeSession) {
        setOpenFolders((prev) => ({
          ...prev,
          [activeSession.role]: true,
        }));
      }
    }
  }, [selectedSessionId, history]);

  const toggleFolder = (role: string) => {
    setOpenFolders((prev) => ({
      ...prev,
      [role]: !prev[role],
    }));
  };

  const roleNames = Object.keys(roleGroups);

  return (
    <aside className="w-[280px] h-full bg-sidebar border-r border-[#2C2C2E] flex flex-col shrink-0 select-none hidden md:flex">
      {/* Top: Logo & Wordmark (clickable to navigate home) */}
      <button
        type="button"
        onClick={onGoHome}
        className="px-5 py-5 flex items-center gap-2.5 w-full text-left hover:opacity-90 transition-opacity cursor-pointer group"
        aria-label="GetHired Home"
      >
        <div className="w-8 h-8 rounded-[10px] bg-[#F5F5F7] flex items-center justify-center group-hover:scale-105 transition-transform">
          <span className="text-[#0A0A0A] text-[14px] font-bold">G</span>
        </div>
        <span className="text-[#F5F5F7] text-[16px] font-semibold tracking-tight">
          GetHired
        </span>
      </button>

      {/* Divider */}
      <div className="w-full h-px bg-[#2C2C2E]" />

      {/* Middle: Role Folders list */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-5 py-3 flex items-center justify-between">
          <span className="text-[#8E8E93] text-[11px] font-medium uppercase tracking-widest">
            Role Folders
          </span>
          {roleNames.length > 0 && (
            <span className="text-[#8E8E93] text-[10px] px-1.5 py-0.5 rounded bg-[#2C2C2E]">
              {roleNames.length} {roleNames.length === 1 ? 'Role' : 'Roles'}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 space-y-1.5 pb-4">
          {roleNames.length === 0 ? (
            <div className="px-4 py-10 flex flex-col items-center text-center">
              <span className="material-symbols-outlined text-[32px] text-[#3A3A3C] mb-2">
                folder_off
              </span>
              <p className="text-[#8E8E93] text-[12px] leading-relaxed">
                No session folders yet.<br />Complete an interview to create a folder.
              </p>
            </div>
          ) : (
            roleNames.map((role) => {
              const isOpen = !!openFolders[role];
              const sessions = roleGroups[role];

              return (
                <div key={role} className="rounded-xl overflow-hidden border border-[#2C2C2E]/60 bg-[#161618]">
                  {/* Folder Header button */}
                  <button
                    type="button"
                    onClick={() => toggleFolder(role)}
                    className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-[#2C2C2E]/50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="material-symbols-outlined text-[18px] text-[#FF9F0A]">
                        {isOpen ? 'folder_open' : 'folder'}
                      </span>
                      <span className="text-[#F5F5F7] text-[13px] font-medium truncate">
                        {role}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[#8E8E93] text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#2C2C2E]">
                        {sessions.length}
                      </span>
                      <span className={`material-symbols-outlined text-[16px] text-[#8E8E93] transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
                        chevron_right
                      </span>
                    </div>
                  </button>

                  {/* Expanded Session Rows */}
                  {isOpen && (
                    <div className="px-1.5 pb-2 pt-1 space-y-1 border-t border-[#2C2C2E]/40 bg-[#0A0A0A]/40">
                      {sessions.map((session) => (
                        <HistoryRow
                          key={session.sessionId}
                          session={session}
                          isSelected={selectedSessionId === session.sessionId}
                          onClick={() => onSelectSession(session.sessionId)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
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
