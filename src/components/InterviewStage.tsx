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
}

export const InterviewStage: React.FC<InterviewStageProps> = ({
  appName = 'GetHired',
  pacingStatus = 'Good Pacing',
  elapsedTime = '00:15:24',
  onEndInterview,
}) => {
  return (
    <section className="flex-1 flex flex-col relative h-full bg-[#1C1C1E] min-h-[400px]">
      {/* Top App Bar (Header) */}
      <header className="w-full px-6 py-5 flex justify-between items-center z-10 pt-8 border-b border-[#2C2C2E]/40 md:border-b-0">
        <h1 className="text-[#F5F5F7] font-semibold text-lg tracking-tight select-none">
          {appName}
        </h1>

        <div className="flex items-center gap-3 md:gap-6">
          <StatusPill label={pacingStatus} icon="check_circle" iconColor="#30D158" />

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

      {/* Center: Visualizer */}
      <div className="flex-1 flex items-center justify-center relative w-full h-full p-8 overflow-hidden">
        <VoiceSphere voiceLevel={0} active={false} />
      </div>
    </section>
  );
};
