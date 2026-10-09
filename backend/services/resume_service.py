import io
import json
from typing import Dict, Any
import pymupdf as fitz
from backend.utils import logger, get_gemini_api_key

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
            logger.error(f"Error reading PDF: {e}")
            raise ValueError(f"Could not read PDF: {str(e)}")

    @staticmethod
    def _call_gemini_json(prompt: str) -> Dict[str, Any]:
        api_key = get_gemini_api_key("resume")
        if not api_key:
            return {}

        # Try google.genai first with real models
        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                from google import genai
                client = genai.Client(api_key=api_key)
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config={
                        'response_mime_type': 'application/json'
                    }
                )
                if response and response.text:
                    return json.loads(response.text.strip())
            except Exception as e:
                logger.debug(f"google.genai resume parsing attempt with {model_name}: {e}")

        # Fallback to legacy google.generativeai
        for model_name in ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-latest']:
            try:
                import google.generativeai as legacy_genai
                legacy_genai.configure(api_key=api_key)
                model = legacy_genai.GenerativeModel(model_name)
                response = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"}
                )
                if response and response.text:
                    return json.loads(response.text.strip())
            except Exception as e:
                logger.debug(f"Legacy Gemini resume parsing with {model_name} failed: {e}")

        return {}

    @classmethod
    def parse_resume_to_structure(cls, raw_text: str) -> Dict[str, Any]:
        """Use Gemini Flash to parse resume text into a consistent JSON schema."""
        if not raw_text.strip():
            return {
                "name": "",
                "email": "",
                "skills": [],
                "experience": [],
                "education": [],
                "summary": ""
            }

        prompt = f"""You are an advanced talent acquisition AI. Parse the following resume text and extract the candidate's key details:
        
--- RESUME TEXT START ---
{raw_text}
--- RESUME TEXT END ---

Output ONLY valid JSON matching this schema:
{{
  "name": "<candidate name>",
  "email": "<candidate email address>",
  "skills": ["<skill1>", "<skill2>", ...],
  "experience": [
    {{
      "company": "<company name>",
      "role": "<job role>",
      "duration": "<dates/duration>",
      "highlights": ["<achievement or responsibility>", ...]
    }}
  ],
  "education": [
    {{
      "institution": "<school/university>",
      "degree": "<degree/field of study>",
      "year": "<graduation year>"
    }}
  ],
  "summary": "<a concise 2-sentence summary of the candidate's professional profile>"
}}
"""
        parsed_data = cls._call_gemini_json(prompt)
        if parsed_data:
            return parsed_data

        # Fallback structure if LLM call fails
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        return {
            "name": "Candidate",
            "email": "",
            "skills": [],
            "experience": [],
            "education": [],
            "summary": " ".join(lines[:3]) if lines else ""
        }
