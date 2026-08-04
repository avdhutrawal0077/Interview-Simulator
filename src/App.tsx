import { useState, useEffect } from 'react';
import { InterviewShell } from './components/InterviewShell';
import { Message } from './types/interview';

const initialMessages: Message[] = [];

export function App() {
  const [questionIndex, setQuestionIndex] = useState(3);
  const [totalQuestions] = useState(8);
  const [isListening, setIsListening] = useState(true);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isInterviewEnded, setIsInterviewEnded] = useState(false);
  const [seconds, setSeconds] = useState(0);

  // Live timer logic
  useEffect(() => {
    if (isInterviewEnded || !isListening) return;

    const interval = setInterval(() => {
      setSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isInterviewEnded, isListening]);

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

  const handleEndInterview = () => {
    setIsInterviewEnded(true);
  };

  const handleRestart = () => {
    setQuestionIndex(3);
    setIsListening(true);
    setMessages(initialMessages);
    setIsInterviewEnded(false);
    setSeconds(0);
  };

  return (
    <div className="w-screen h-screen min-h-screen overflow-hidden bg-[#0A0A0A] relative flex flex-col items-center justify-center p-0">
      <InterviewShell
        questionIndex={questionIndex}
        totalQuestions={totalQuestions}
        appName="NextRound"
        pacingStatus="Good Pacing"
        elapsedTime={elapsedTime}
        messages={messages}
        isListening={isListening}
        isFullScreen={true}
        onToggleListening={handleToggleListening}
        onRefreshMessage={handleRefreshMessage}
        onEndInterview={handleEndInterview}
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
      </div>

      {/* End Interview Modal Overlay */}
      {isInterviewEnded && (
        <div className="fixed inset-0 bg-[#0A0A0A]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-[#1C1C1E] border border-[#2C2C2E] rounded-[24px] p-8 max-w-md w-full flex flex-col items-center text-center gap-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-[#2C2C2E] border border-[#3A3A3C] flex items-center justify-center text-[#30D158]">
              <span className="material-symbols-outlined text-2xl">check_circle</span>
            </div>
            <h3 className="text-xl font-semibold text-[#F5F5F7]">
              Interview Session Ended
            </h3>
            <p className="text-sm text-[#8E8E93] leading-relaxed">
              You completed {questionIndex} out of {totalQuestions} questions with overall good pacing.
            </p>
            <div className="flex gap-3 w-full mt-2">
              <button
                onClick={() => setIsInterviewEnded(false)}
                className="flex-1 py-2.5 px-4 bg-[#2C2C2E] border border-[#3A3A3C] rounded-[12px] text-[#F5F5F7] text-sm font-medium hover:bg-[#343539] transition-colors"
              >
                Resume
              </button>
              <button
                onClick={handleRestart}
                className="flex-1 py-2.5 px-4 bg-[#F5F5F7] text-[#0A0A0A] rounded-[12px] text-sm font-medium hover:bg-white transition-colors"
              >
                Restart Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
