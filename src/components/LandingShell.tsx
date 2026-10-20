import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { JobRole, SessionSummary } from '../types/interview';
import { getHistory, getFullSession, deleteSession } from '../utils/sessionStorage';
import { api } from '../services/api';
import { HistorySidebar } from './HistorySidebar';
import { ResumeUploadBar } from './ResumeUploadBar';
import { StartButton } from './StartButton';
import { ReportView } from './ReportView';

// ─── Model readiness poll ─────────────────────────────────────────────────────

type ModelStatus = 'checking' | 'loading' | 'ready' | 'offline';

async function fetchModelStatus(): Promise<{ stt_ready: boolean; stt_loading: boolean } | null> {
  try {
    const res = await fetch('/health', { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ─── Settings Modal ───────────────────────────────────────────────────────────

interface SettingsModalProps {
  onClose: () => void;
  onClearHistory: () => void;
  sessionCount: number;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onClearHistory, sessionCount }) => (
  <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-2xl p-6 w-full max-w-sm flex flex-col gap-5 shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[#F5F5F7] font-semibold text-base">Settings</h2>
        <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-[#2C2C2E] transition-colors cursor-pointer">
          <span className="material-symbols-outlined text-[18px] text-[#8E8E93]">close</span>
        </button>
      </div>

      {/* Storage info */}
      <div className="flex items-start gap-3 px-4 py-3 bg-[#0A0A0A] rounded-xl border border-[#2C2C2E]">
        <span className="material-symbols-outlined text-[20px] text-[#0A84FF] shrink-0 mt-0.5">storage</span>
        <div>
          <p className="text-[#F5F5F7] text-[13px] font-medium">Local Storage</p>
          <p className="text-[#8E8E93] text-[11px] mt-0.5 leading-relaxed">
            Your interview reports are saved locally in this browser. {sessionCount} session{sessionCount !== 1 ? 's' : ''} stored.
            No data is sent to any server.
          </p>
        </div>
      </div>

      {/* Clear history */}
      <div className="flex flex-col gap-2">
        <p className="text-[#8E8E93] text-[11px] uppercase tracking-wider font-medium">Danger Zone</p>
        <button
          onClick={onClearHistory}
          className="w-full flex items-center gap-2 px-4 py-3 rounded-xl border border-[#FF453A]/30 bg-[#FF453A]/10 text-[#FF453A] text-[13px] font-medium hover:bg-[#FF453A]/20 transition-colors cursor-pointer"
        >
          <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
          Clear All Interview History ({sessionCount})
        </button>
        <p className="text-[#636366] text-[10px] text-center">This cannot be undone.</p>
      </div>
    </div>
  </div>
);

// ─── Component ────────────────────────────────────────────────────────────────

export const LandingShell: React.FC = () => {
  const navigate = useNavigate();

  // Landing state
  const [resumeFile, setResumeFile]     = useState<File | null>(null);
  const [selectedRole, setSelectedRole] = useState<JobRole | null>(null);
  const [history, setHistory]           = useState<SessionSummary[]>([]);
  const [isLoading, setIsLoading]       = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  // ── STT model readiness ───────────────────────────────────────────────────
  const [modelStatus, setModelStatus] = useState<ModelStatus>('checking');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const data = await fetchModelStatus();
      if (cancelled) return;
      if (!data) { setModelStatus('offline'); pollTimerRef.current = setTimeout(poll, 3000); return; }
      if (data.stt_ready) { setModelStatus('ready'); return; }
      setModelStatus('loading');
      pollTimerRef.current = setTimeout(poll, 2000);
    };
    poll();
    return () => { cancelled = true; if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  }, []);

  // Active report selection state
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const refreshHistory = () => { setHistory(getHistory()); };
  useEffect(() => { refreshHistory(); }, []);

  const handleStartInterview = async () => {
    if (!resumeFile || !selectedRole || isLoading || modelStatus !== 'ready') return;
    try {
      setIsLoading(true);
      setLoadingStatus('Creating interview session...');
      const sessionRes = await api.startSession('Candidate', selectedRole);
      const sessionId  = sessionRes.sessionId;

      setLoadingStatus('Analyzing resume & extracting skills...');
      await api.uploadResume(resumeFile, sessionId);

      setLoadingStatus('Generating personalized interview question...');
      const questionRes = await api.getQuestion(sessionId);

      navigate('/interview', {
        state: {
          resumeFile,
          role: selectedRole,
          sessionId,
          initialQuestion: questionRes.questionText,
          totalQuestions:  questionRes.totalQuestions || 8,
        },
      });
    } catch (error) {
      console.error('Failed to start interview:', error);
      navigate('/interview', { state: { resumeFile, role: selectedRole } });
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  const handleSelectSession   = (id: string) => setSelectedSessionId(id);
  const handleGoHome          = () => { setSelectedSessionId(null); refreshHistory(); };

  const handleDeleteSession = (sessionId: string) => {
    deleteSession(sessionId);
    if (selectedSessionId === sessionId) setSelectedSessionId(null);
    refreshHistory();
  };

  const handleClearAllHistory = () => {
    if (!window.confirm(`Delete all ${history.length} interview reports? This cannot be undone.`)) return;
    history.forEach(s => deleteSession(s.sessionId));
    setSelectedSessionId(null);
    refreshHistory();
    setShowSettings(false);
  };

  const activeFullSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return getFullSession(selectedSessionId);
  }, [selectedSessionId]);

  const activeRoleSessions = useMemo(() => {
    if (!activeFullSession) return [];
    return history.filter(s => s.role === activeFullSession.role);
  }, [activeFullSession, history]);

  const isReady = resumeFile !== null && selectedRole !== null && !isLoading && modelStatus === 'ready';

  const modelPill = (() => {
    switch (modelStatus) {
      case 'checking': return { bg: 'bg-[#2C2C2E] border-[#3A3A3C]', dot: 'bg-[#8E8E93]', dotClass: '', text: 'Checking speech engine…', textColor: 'text-[#8E8E93]' };
      case 'loading':  return { bg: 'bg-[#FF9F0A]/10 border-[#FF9F0A]/30', dot: 'bg-[#FF9F0A]', dotClass: 'animate-pulse', text: 'Loading speech model — please wait…', textColor: 'text-[#FF9F0A]' };
      case 'offline':  return { bg: 'bg-[#FF453A]/10 border-[#FF453A]/30', dot: 'bg-[#FF453A]', dotClass: '', text: 'Backend offline — start the Python server first.', textColor: 'text-[#FF453A]' };
      case 'ready':    return { bg: 'bg-[#30D158]/10 border-[#30D158]/30', dot: 'bg-[#30D158]', dotClass: '', text: 'Speech engine ready', textColor: 'text-[#30D158]' };
    }
  })();

  return (
    <div className="w-screen h-screen min-h-screen overflow-hidden bg-[#0A0A0A] flex">
      {/* Left Sidebar */}
      <HistorySidebar
        history={history}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSession}
        onGoHome={handleGoHome}
        onDeleteSession={handleDeleteSession}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        {selectedSessionId && activeFullSession ? (
          <ReportView
            session={activeFullSession}
            roleSessions={activeRoleSessions}
            onClose={handleGoHome}
            onDelete={() => handleDeleteSession(selectedSessionId)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center relative p-6 overflow-y-auto custom-scrollbar">
            <div className="w-full max-w-[920px] mx-auto flex flex-col items-center px-6">
              <div className="landing-glow w-full flex flex-col items-center py-16 md:py-24 px-4">
                <h1 className="headline-animate text-headline-lg-mobile md:text-display-lg text-[#F5F5F7] text-center mb-10 select-none">
                  Ready whenever you are.
                </h1>

                {/* Upload / role bar */}
                <ResumeUploadBar
                  resumeFile={resumeFile}
                  selectedRole={selectedRole}
                  onFileSelect={setResumeFile}
                  onRoleSelect={setSelectedRole}
                />

                {/* Start button */}
                <StartButton disabled={!isReady} onClick={handleStartInterview} />

                {/* Model readiness status pill */}
                <div className={`mt-5 flex items-center gap-2 px-4 py-2 rounded-full border ${modelPill.bg} transition-all duration-500`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${modelPill.dot} ${modelPill.dotClass}`} />
                  <span className={`text-[12px] font-medium ${modelPill.textColor} select-none`}>{modelPill.text}</span>
                  {modelStatus === 'loading' && (
                    <span className="material-symbols-outlined text-[14px] text-[#FF9F0A] animate-spin ml-0.5">progress_activity</span>
                  )}
                </div>

                {/* Session-start loading status */}
                {isLoading && (
                  <div className="mt-3 flex items-center gap-2 text-[#30D158] text-xs font-medium animate-pulse">
                    <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                    <span>{loadingStatus}</span>
                  </div>
                )}

                {!isLoading && modelStatus === 'ready' && (
                  <div className="mt-3 flex flex-col items-center gap-1 select-none">
                    <p className="text-[#8E8E93] text-[12px] text-center">
                      Upload your resume as PDF and select a role to begin.
                    </p>
                    <p className="text-[#636366] text-[11px] text-center flex items-center gap-1">
                      <span className="material-symbols-outlined text-[13px]">history</span>
                      Reports auto-save to your browser — find them in the sidebar on the left.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onClearHistory={handleClearAllHistory}
          sessionCount={history.length}
        />
      )}
    </div>
  );
};
