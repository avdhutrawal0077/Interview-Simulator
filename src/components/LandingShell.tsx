import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { JobRole, SessionSummary } from '../types/interview';
import { getHistory, getFullSession } from '../utils/sessionStorage';
import { HistorySidebar } from './HistorySidebar';
import { ResumeUploadBar } from './ResumeUploadBar';
import { StartButton } from './StartButton';
import { ReportView } from './ReportView';

export const LandingShell: React.FC = () => {
  const navigate = useNavigate();

  // Landing state
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [selectedRole, setSelectedRole] = useState<JobRole | null>(null);
  const [history, setHistory] = useState<SessionSummary[]>([]);

  // Active report selection state
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  // Load / refresh history
  const refreshHistory = () => {
    setHistory(getHistory());
  };

  useEffect(() => {
    refreshHistory();
  }, []);

  const handleStartInterview = () => {
    if (!resumeFile || !selectedRole) return;
    navigate('/interview', {
      state: { resumeFile, role: selectedRole },
    });
  };

  const handleSelectSession = (sessionId: string) => {
    setSelectedSessionId(sessionId);
  };

  const handleGoHome = () => {
    setSelectedSessionId(null);
    refreshHistory(); // pick up any newly saved sessions
  };


  // Full session data for the selected session
  const activeFullSession = useMemo(() => {
    if (!selectedSessionId) return null;
    return getFullSession(selectedSessionId);
  }, [selectedSessionId]);

  // All history sessions matching the active session's role (for trend line chart)
  const activeRoleSessions = useMemo(() => {
    if (!activeFullSession) return [];
    return history.filter((s) => s.role === activeFullSession.role);
  }, [activeFullSession, history]);

  const isReady = resumeFile !== null && selectedRole !== null;

  return (
    <div className="w-screen h-screen min-h-screen overflow-hidden bg-[#0A0A0A] flex">
      {/* Left Sidebar */}
      <HistorySidebar
        history={history}
        selectedSessionId={selectedSessionId}
        onSelectSession={handleSelectSession}
        onGoHome={handleGoHome}
      />

      {/* Main Content Area: Swaps between Home CTA and Full Canvas Report View */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden">
        {selectedSessionId && activeFullSession ? (
          <ReportView
            session={activeFullSession}
            roleSessions={activeRoleSessions}
            onClose={handleGoHome}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center relative p-6 overflow-y-auto custom-scrollbar">
            {/* Card shell */}
            <div className="w-full max-w-[920px] mx-auto flex flex-col items-center px-6">
              {/* Radial glow container */}
              <div className="landing-glow w-full flex flex-col items-center py-16 md:py-24 px-4">
                {/* Headline — mist-resolves on mount */}
                <h1 className="headline-animate text-headline-lg-mobile md:text-display-lg text-[#F5F5F7] text-center mb-10 select-none">
                  Ready whenever you are.
                </h1>

                {/* Upload bar */}
                <ResumeUploadBar
                  resumeFile={resumeFile}
                  selectedRole={selectedRole}
                  onFileSelect={setResumeFile}
                  onRoleSelect={setSelectedRole}
                />

                {/* Start button */}
                <StartButton
                  disabled={!isReady}
                  onClick={handleStartInterview}
                />

                {/* Subtle hint */}
                <p className="mt-5 text-[#8E8E93] text-[12px] text-center select-none">
                  Upload your resume as PDF and select a target role to begin a mock interview.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
