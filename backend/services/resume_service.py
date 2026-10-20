"""
backend/services/resume_service.py
────────────────────────────────────
Resume PDF extraction, structured parsing, and RAG feature extraction.
Uses the centralized LLM client with model fallback chain.
"""

import re
from typing import Any, Dict, List
import pymupdf as fitz
from backend.utils import logger, get_gemini_api_key
from backend.services.llm import generate_json, generate_text


class ResumeParserService:

    @staticmethod
    def extract_text_from_pdf(file_bytes: bytes) -> str:
        """Extract plain text from uploaded PDF bytes."""
        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            text = ""
            for page in doc:
                text += page.get_text() + "\n"
            return text.strip()
        except Exception as e:
            logger.error(f"[Resume] PDF extraction error: {e}")
            raise ValueError(f"Could not read PDF: {e}")

    @staticmethod
    def _extract_name_heuristic(raw_text: str) -> str:
        """
        Fast heuristic: the candidate's name is almost always in the
        first 3 non-empty lines of a resume, and is typically 2–4 words
        with no numbers, colons, or @ symbols.
        """
        lines = [l.strip() for l in raw_text.splitlines() if l.strip()][:10]
        for line in lines:
            if any(c in line for c in ["@", ":", "http", "+", "linkedin", "github"]):
                continue
            if re.search(r"\d", line):
                continue
            words = line.split()
            if 2 <= len(words) <= 4 and all(w[0].isupper() for w in words if w):
                return line
        return ""

    @classmethod
    def parse_resume_to_structure(cls, raw_text: str) -> Dict[str, Any]:
        """Parse resume text into structured JSON using Gemini."""
        if not raw_text.strip():
            return {"name": "", "email": "", "skills": [], "experience": [], "education": [], "summary": ""}

        api_key = get_gemini_api_key("resume")

        prompt = f"""Parse the following resume and extract structured information.
Return ONLY valid JSON — no markdown, no extra text.

Resume:
---
{raw_text[:4000]}
---

JSON schema:
{{
  "name": "<candidate's full name>",
  "email": "<email address>",
  "phone": "<phone number>",
  "skills": ["<skill1>", "<skill2>", ...],
  "experience": [
    {{
      "company": "<company>",
      "role": "<job title>",
      "duration": "<start – end>",
      "highlights": ["<achievement 1>", "<achievement 2>"]
    }}
  ],
  "education": [
    {{
      "institution": "<university>",
      "degree": "<degree>",
      "year": "<graduation year>"
    }}
  ],
  "summary": "<2-sentence professional summary>"
}}"""

        parsed = generate_json(prompt, api_key)
        if parsed and parsed.get("name"):
            return parsed

        # Heuristic fallback
        name = cls._extract_name_heuristic(raw_text)
        lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
        return {
            "name": name,
            "email": "",
            "skills": [],
            "experience": [],
            "education": [],
            "summary": " ".join(lines[:3]) if lines else "",
        }

    @classmethod
    def extract_rag_features(cls, raw_text: str, role: str = "") -> List[str]:
        """
        Extract structured interview-relevant feature documents from a resume.

        Returns a list of concise feature strings to be stored as individual
        ChromaDB documents. Each string is self-contained and semantically rich,
        so that embedding + retrieval gives the question generator actionable context.

        Returns empty list on failure (non-fatal — raw chunks are always indexed separately).
        """
        if not raw_text.strip():
            return []

        api_key = get_gemini_api_key("resume")

        prompt = f"""You are an expert technical interviewer analysing a resume for a {role or 'tech'} role.

Extract structured interview-relevant features from this resume.
Return ONLY valid JSON — no markdown, no extra text.

Resume (truncated to 4000 chars):
---
{raw_text[:4000]}
---

JSON schema:
{{
  "core_skills": ["<top 8 technical skills the candidate has>"],
  "experience_summary": "<1-sentence: X years of experience in Y domains at Z companies>",
  "notable_projects": ["<project 1: what it was and the tech used>", "<project 2>"],
  "education": "<degree and institution in 1 line>",
  "domain_expertise": ["<primary domain 1>", "<primary domain 2>"],
  "seniority_level": "<junior|mid|senior|lead|principal>",
  "interview_hooks": [
    "<specific follow-up angle 1: e.g. 'Worked on microservices at CompanyX — ask about service boundary decisions'>",
    "<follow-up angle 2>",
    "<follow-up angle 3>"
  ],
  "potential_gaps": ["<gap 1 vs {role} expectations>", "<gap 2>"]
}}"""

        try:
            features = generate_json(prompt, api_key)
            if not features:
                return []

            # Convert structured JSON into self-contained feature strings for embedding
            feature_docs: List[str] = []

            # Skills block
            skills = features.get("core_skills", [])
            if skills:
                feature_docs.append(
                    f"Candidate's core technical skills: {', '.join(skills[:8])}. "
                    f"Seniority: {features.get('seniority_level', 'unknown')}. "
                    f"Domains: {', '.join(features.get('domain_expertise', [])[:3])}."
                )

            # Experience
            exp = features.get("experience_summary", "")
            if exp:
                feature_docs.append(f"Candidate experience: {exp}")

            # Projects
            for proj in features.get("notable_projects", [])[:3]:
                if proj:
                    feature_docs.append(f"Notable project: {proj}")

            # Education
            edu = features.get("education", "")
            if edu:
                feature_docs.append(f"Education: {edu}")

            # Interview hooks — most valuable for tailored questions
            for hook in features.get("interview_hooks", [])[:4]:
                if hook:
                    feature_docs.append(f"Interview hook: {hook}")

            # Potential gaps — useful for probing questions
            gaps = features.get("potential_gaps", [])
            if gaps:
                feature_docs.append(
                    f"Potential skill gaps for {role} role: {'; '.join(gaps[:3])}."
                )

            logger.info(f"[Resume] Extracted {len(feature_docs)} RAG feature documents from resume.")
            return feature_docs

        except Exception as e:
            logger.warning(f"[Resume] RAG feature extraction failed (non-fatal): {e}")
            return []
