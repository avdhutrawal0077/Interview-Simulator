import React from 'react';

interface StatusPillProps {
  label: string;
  icon?: string;
  iconColor?: string;
  className?: string;
  onClick?: () => void;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  label,
  icon = 'check_circle',
  iconColor = '#30D158',
  className = '',
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1 bg-[#2C2C2E] border border-[#3A3A3C] rounded-full select-none ${
        onClick ? 'cursor-pointer hover:bg-[#343539] transition-colors' : ''
      } ${className}`}
    >
      {icon && (
        <span
          className="material-symbols-outlined text-[14px]"
          style={{ color: iconColor }}
        >
          {icon}
        </span>
      )}
      <span className="text-[#F5F5F7] text-[11px] font-medium">{label}</span>
    </div>
  );
};
