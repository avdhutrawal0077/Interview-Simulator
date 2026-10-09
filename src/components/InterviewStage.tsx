import React from 'react';
import { StatusPill } from './StatusPill';
import { VoiceSphere } from './VoiceSphere';
import { SphereState } from '../types/interview';

interface InterviewStageProps {
  appName?: string;
  pacingStatus?: string;
  elapsedTime?: string;
  onEndInterview?: () => void;
  sphereState?: SphereState;
  audioLevel?: number;
  videoRef?: React.RefObject<HTMLVideoElement>;
}

export const InterviewStage: React.FC<InterviewStageProps> = ({
  appName = 'GetHired',
  pacingStatus = 'Good Pacing',
  elapsedTime = '00:15:24',
  onEndInterview,
  sphereState = 'idle',
  audioLevel = 0,
  videoRef,
}) => {
  const getStatusLabel = (state: SphereState) => {
    switch (state) {
      case 'speaking':
        return 'Interviewer Speaking';
      case 'listening':
        return 'Listening to You';
      case 'thinking':
        return 'Analyzing Response';
      default:
        return 'Ready';
    }
  };

  const getStatusIcon = (state: SphereState) => {
    switch (state) {
      case 'speaking':
        return 'volume_up';
      case 'listening':
        return 'mic';
      case 'thinking':
        return 'psychology';
      default:
        return 'check_circle';
    }
  };

  return (
    <section className="flex-1 flex flex-col relative h-full bg-[#1C1C1E] min-h-[400px]">
      {/* Top App Bar (Header) */}
      <header className="w-full px-6 py-5 flex justify-between items-center z-10 pt-8 border-b border-[#2C2C2E]/40 md:border-b-0">
        <h1 className="text-[#F5F5F7] font-semibold text-lg tracking-tight select-none">
          {appName}
        </h1>

        <div className="flex items-center gap-3 md:gap-6">
          <StatusPill
            label={getStatusLabel(sphereState)}
            icon={getStatusIcon(sphereState)}
            iconColor={sphereState === 'listening' ? '#30D158' : '#8E8E93'}
          />

          <div className="hidden lg:block">
            <StatusPill label={pacingStatus} icon="speed" iconColor="#0A84FF" />
          </div>

          <span className="text-[#8E8E93] font-mono text-sm tracking-wider select-none hidden sm:inline-block">
            {elapsedTime}
          </span>

          <button
            onClick={onEndInterview}
            className="px-4 py-2 bg-[#2C2C2E] border border-[#3A3A3C] rounded-full text-[#F5F5F7] text-sm font-medium transition-colors hover:text-red-400 hover:border-red-900 focus:outline-none min-h-[44px] flex items-center justify-center cursor-pointer select-none"
          >
            End Interview
          </button>
        </div>
      </header>

      {/* Center: 3D Visualizer Orb */}
      <div className="flex-1 flex items-center justify-center relative w-full h-full p-8 overflow-hidden">
        <VoiceSphere voiceLevel={audioLevel} active={sphereState === 'listening'} />

        {/* Video Overlay for MediaPipe Biometrics */}
        {videoRef && (
          <div className="absolute bottom-6 right-6 w-32 h-32 md:w-40 md:h-40 rounded-2xl overflow-hidden border border-[#2C2C2E]/80 shadow-2xl bg-[#0A0A0A]/40 backdrop-blur-sm z-20">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover scale-x-[-1]" // mirror display
            />
            <div className="absolute bottom-2 left-2 bg-[#1C1C1E]/80 backdrop-blur px-2 py-0.5 rounded-full border border-[#2C2C2E] flex items-center gap-1 select-none pointer-events-none">
              <span className="w-1.5 h-1.5 rounded-full bg-[#30D158] animate-pulse"></span>
              <span className="text-[9px] font-semibold text-[#8E8E93] uppercase tracking-wider">Vision</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
