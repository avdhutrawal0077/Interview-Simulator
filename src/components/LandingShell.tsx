import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { JobRole, SessionSummary, SessionFullExport } from '../types/interview';
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

  // Report modal state
  const [viewingSession, setViewingSession] = useState<SessionFullExport | null>(null);

  // Load history on mount
  useEffect(() => {
    setHistory(getHistory());
  }, []);

  const handleStartInterview = () => {
    if (!resumeFile || !selectedRole) return;
    navigate('/interview', {
      state: { resumeFile, role: selectedRole },
    });
  };

  const handleSelectSession = (sessionId: string) => {
    const fullSession = getFullSession(sessionId);
    if (fullSession) {
      setViewingSession(fullSession);
    }
  };

  const isReady = resumeFile !== null && selectedRole !== null;

  return (
    <div className="w-screen h-screen min-h-screen overflow-hidden bg-[#0A0A0A] flex">
      {/* Left Sidebar */}
      <HistorySidebar history={history} onSelectSession={handleSelectSession} />

      {/* Main Content Area */}
      <div className="flex-1 flex items-center justify-center relative">
        {/* Card shell */}
        <div className="w-full max-w-[920px] mx-auto flex flex-col items-center px-6">
          {/* Radial glow container */}
          <div className="landing-glow w-full flex flex-col items-center py-16 md:py-24 px-4">
            {/* Headline */}
            <h1 className="text-headline-lg-mobile md:text-display-lg text-[#F5F5F7] text-center mb-10 select-none">
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

      {/* Report View Modal */}
      {viewingSession && (
        <ReportView
          session={viewingSession}
          onClose={() => setViewingSession(null)}
        />
      )}
    </div>
  );
};
