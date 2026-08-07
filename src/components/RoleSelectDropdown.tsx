import React, { useState, useRef, useEffect } from 'react';
import { JobRole, JOB_ROLES } from '../types/interview';

interface RoleSelectDropdownProps {
  selectedRole: JobRole | null;
  onSelect: (role: JobRole) => void;
}

export const RoleSelectDropdown: React.FC<RoleSelectDropdownProps> = ({
  selectedRole,
  onSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 bg-[#2C2C2E] border border-[#3A3A3C] rounded-full cursor-pointer hover:bg-[#343539] transition-colors select-none min-h-[36px]"
      >
        <span className="material-symbols-outlined text-[14px] text-[#8E8E93]">
          work
        </span>
        <span className="text-[#F5F5F7] text-[13px] font-medium whitespace-nowrap">
          {selectedRole || 'Select Role'}
        </span>
        <span
          className={`material-symbols-outlined text-[16px] text-[#8E8E93] transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        >
          expand_more
        </span>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 role-menu py-1 min-w-[220px] z-50">
          {JOB_ROLES.map((role) => (
            <button
              key={role}
              type="button"
              onClick={() => {
                onSelect(role);
                setIsOpen(false);
              }}
              className={`role-menu-item w-full text-left px-4 py-2.5 text-[14px] font-medium flex items-center gap-3 ${
                selectedRole === role
                  ? 'text-[#F5F5F7] bg-[#3A3A3C]'
                  : 'text-[#c5c7c9]'
              }`}
            >
              {selectedRole === role && (
                <span className="material-symbols-outlined text-[16px] text-[#F5F5F7]">
                  check
                </span>
              )}
              {selectedRole !== role && <span className="w-4" />}
              {role}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
