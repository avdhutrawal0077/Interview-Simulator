import React from 'react';

interface StartButtonProps {
  disabled: boolean;
  onClick: () => void;
}

export const StartButton: React.FC<StartButtonProps> = ({ disabled, onClick }) => {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`
        mt-6 px-8 py-3 rounded-button text-[15px] font-semibold
        transition-all duration-200 ease-out select-none
        min-h-[48px] min-w-[180px]
        ${
          disabled
            ? 'bg-[#F5F5F7]/40 text-[#0A0A0A]/50 cursor-not-allowed'
            : 'bg-[#F5F5F7] text-[#0A0A0A] cursor-pointer hover:bg-white hover:scale-[1.03] hover:shadow-[0_0_24px_rgba(255,255,255,0.12)] active:scale-[0.98]'
        }
      `}
    >
      Start Interview
    </button>
  );
};
