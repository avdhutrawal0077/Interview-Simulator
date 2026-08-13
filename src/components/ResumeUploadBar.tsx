import React, { useRef } from 'react';
import { JobRole } from '../types/interview';
import { RoleSelectDropdown } from './RoleSelectDropdown';

interface ResumeUploadBarProps {
  resumeFile: File | null;
  selectedRole: JobRole | null;
  onFileSelect: (file: File | null) => void;
  onRoleSelect: (role: JobRole) => void;
}

export const ResumeUploadBar: React.FC<ResumeUploadBarProps> = ({
  resumeFile,
  selectedRole,
  onFileSelect,
  onRoleSelect,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      onFileSelect(file);
    }
    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  const handleRemoveFile = () => {
    onFileSelect(null);
  };

  const hasContent = resumeFile || selectedRole;

  return (
    <div className="relative w-full max-w-[640px] flex justify-center items-center">
      {/* Ambient white radial glow behind central CTA */}
      <div className="cta-radial-glow" aria-hidden="true" />

      <div className="upload-bar flex items-center gap-2 px-2 py-2 w-full max-w-[640px]">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileChange}
          className="hidden"
          aria-label="Upload resume PDF"
        />

        {/* Left zone: + button or filename chip */}
        {resumeFile ? (
          <div className="file-chip flex items-center gap-2 px-3 py-1.5 ml-1 shrink-0">
            <span className="material-symbols-outlined text-[14px] text-[#8E8E93]">
              description
            </span>
            <span className="text-[#F5F5F7] text-[12px] font-medium max-w-[140px] truncate">
              {resumeFile.name}
            </span>
            <button
              type="button"
              onClick={handleRemoveFile}
              className="text-[#8E8E93] hover:text-[#F5F5F7] transition-colors ml-0.5"
              aria-label="Remove file"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-9 h-9 rounded-full bg-[#2C2C2E] border border-[#3A3A3C] flex items-center justify-center hover:bg-[#343539] transition-colors shrink-0 ml-1 cursor-pointer"
            aria-label="Upload resume"
          >
            <span className="material-symbols-outlined text-[18px] text-[#8E8E93]">
              add
            </span>
          </button>
        )}

        {/* Middle zone: placeholder text */}
        <div
          className={`flex-1 flex items-center justify-center transition-opacity duration-300 ${
            hasContent ? 'opacity-0 pointer-events-none' : 'opacity-100'
          }`}
        >
          <span className="text-[#8E8E93] text-[14px] font-normal whitespace-nowrap select-none">
            Upload resume &amp; pick a role to begin
          </span>
        </div>

        {/* Right zone: role dropdown */}
        <div className="shrink-0 mr-1">
          <RoleSelectDropdown selectedRole={selectedRole} onSelect={onRoleSelect} />
        </div>
      </div>
    </div>
  );
};
