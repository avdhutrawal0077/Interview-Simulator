import { useState, useEffect, useMemo } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { InterviewShell } from './components/InterviewShell';
import { LandingShell } from './components/LandingShell';
import { Message, JobRole, SessionSummary, SphereState } from './types/interview';
import { generateSessionId, saveSession } from './utils/sessionStorage';

const initialMessages: Message[] = [];

/** Interview page — receives resumeFile & role via location state */
function InterviewPage() {
  const location = useLocation();
  const navigate = useNavigate();

  // Read state passed from LandingShell
  const locationState = location.state as {
    resumeFile?: File;
    role?: JobRole;
  } | null;

  const role = locationState?.role ?? 'Software Engineer';
  const sessionId = useMemo(() => generateSessionId(), []);
  const sessionDate = useMemo(() => new Date().toISOString(), []);

  const [questionIndex, setQuestionIndex] = useState(1);
  const [totalQuestions] = useState(8);
  const [isListening, setIsListening] = useState(true);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [showEndConfirmation, setShowEndConfirmation] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Live timer logic
  useEffect(() => {
    if (!isListening || showEndConfirmation) return;

    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isListening, showEndConfirmation]);

  const formatTime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return [hrs, mins, secs]
      .map((v) => String(v).padStart(2, '0'))
      .join(':');
  };

  const elapsedTime = formatTime(seconds);

  const handleToggleListening = () => {
    setIsListening((prev) => !prev);
  };

  const handleRefreshMessage = (id: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.id === id) {
          return {
            ...msg,
            text: msg.text + ' (Refreshed context with alternative focus.)',
          };
        }
        return msg;
      })
    );
  };

  // Open confirmation warning modal
  const handleRequestEndInterview = () => {
    setShowEndConfirmation(true);
  };

  // Confirm ending interview -> save session and navigate directly to home screen
  const handleConfirmEndInterview = () => {
    setShowEndConfirmation(false);

    // Persist session to history
    const overallScore = Math.floor(60 + Math.random() * 30); // Mock score
    const summary: SessionSummary = {
      sessionId,
      role,
      date: sessionDate,
      overallScore,
      questionsCompleted: questionIndex,
      totalQuestions,
    };
    saveSession(summary, {
      sessionId,
      role,
      date: sessionDate,
      overallScore,
      questionsCompleted: questionIndex,
      totalQuestions,
      elapsedTime,
      messages,
    });

    // Navigate immediately to home screen
    navigate('/');
  };

  // Compute sphere visual state
  const sphereState: SphereState = isListening ? 'listening' : 'idle';
  const [mockSphereState, setMockSphereState] = useState<SphereState | null>(null);
  const activeSphereState = mockSphereState ?? sphereState;

  return (
    <div className="w-screen h-screen min-h-screen overflow-hidden bg-[#0A0A0A] relative flex flex-col items-center justify-center p-0">
      <InterviewShell
        questionIndex={questionIndex}
        totalQuestions={totalQuestions}
        appName="GetHired"
        pacingStatus="Good Pacing"
        elapsedTime={elapsedTime}
        messages={messages}
        isListening={isListening}
        isFullScreen={true}
        onToggleListening={handleToggleListening}
        onRefreshMessage={handleRefreshMessage}
        onEndInterview={handleRequestEndInterview}
        sphereState={activeSphereState}
        audioLevel={isListening ? 0.3 : 0}
      />

      {/* Floating Interactive Controls (For Mock Testing) */}
      <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 bg-[#1C1C1E]/90 backdrop-blur-md border border-[#2C2C2E] rounded-full text-xs text-[#8E8E93] shadow-lg">
        <span className="font-semibold text-[#F5F5F7]">Mock Controls:</span>
        <button
          onClick={() => setQuestionIndex((q) => Math.max(1, q - 1))}
          disabled={questionIndex <= 1}
          className="hover:text-[#F5F5F7] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev Question
        </button>
        <span className="text-[#3A3A3C]">|</span>
        <button
          onClick={() => setQuestionIndex((q) => Math.min(totalQuestions, q + 1))}
          disabled={questionIndex >= totalQuestions}
          className="hover:text-[#F5F5F7] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Next Question →
        </button>
        <span className="text-[#3A3A3C]">|</span>
        <button
          onClick={handleToggleListening}
          className="hover:text-[#F5F5F7] transition-colors"
        >
          {isListening ? 'Pause Listening' : 'Resume Listening'}
        </button>
        <span className="text-[#3A3A3C]">|</span>
        <span className="font-semibold text-[#F5F5F7]">Sphere State:</span>
        {(['idle', 'listening', 'thinking', 'speaking'] as const).map((st) => (
          <button
            key={st}
            onClick={() => setMockSphereState(st === mockSphereState ? null : st)}
            className={`px-1.5 py-0.5 rounded capitalize transition-colors ${
              activeSphereState === st
                ? 'bg-[#30D158]/20 text-[#30D158] font-medium'
                : 'hover:text-[#F5F5F7]'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {/* End Interview Confirmation Warning Modal */}
      {showEndConfirmation && (
        <div className="fixed inset-0 bg-[#0A0A0A]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] p-8 max-w-md w-full flex flex-col items-center text-center gap-5 shadow-2xl">
            <div className="w-14 h-14 rounded-full bg-[#FF9F0A]/15 border border-[#FF9F0A]/30 flex items-center justify-center text-[#FF9F0A]">
              <span className="material-symbols-outlined text-3xl">warning</span>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-[#F5F5F7] mb-2">
                End Interview?
              </h3>
              <p className="text-sm text-[#8E8E93] leading-relaxed">
                Are you sure you want to end your current session? You will return to the home screen and your session will be saved in history.
              </p>
            </div>

            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setShowEndConfirmation(false)}
                className="flex-1 py-3 px-4 bg-[#2C2C2E] border border-[#3A3A3C] rounded-[12px] text-[#F5F5F7] text-sm font-medium hover:bg-[#343539] transition-colors cursor-pointer"
              >
                Resume Interview
              </button>
              <button
                onClick={handleConfirmEndInterview}
                className="flex-1 py-3 px-4 bg-[#FF453A] hover:bg-[#FF3B30] text-white rounded-[12px] text-sm font-semibold transition-colors shadow-lg cursor-pointer"
              >
                End Interview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingShell />} />
      <Route path="/interview" element={<InterviewPage />} />
    </Routes>
  );
}

export default App;
