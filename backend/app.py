import os
import sys
from pathlib import Path

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.routers import session, resume, interview, transcribe
from backend.utils import logger

app = FastAPI(
    title="AI Interview Simulator Backend",
    description="FastAPI backend for AI-powered mock interview simulator with speech, vision, and LLM reasoning.",
    version="1.0.0"
)

# CORS setup for local React development and production
origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "*"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(session.router)
app.include_router(resume.router)
app.include_router(interview.router)
app.include_router(transcribe.router)

@app.get("/health")
async def health():
    return {"status": "ok"}

# Mount and serve built React frontend if dist exists
DIST_DIR = PROJECT_ROOT / "dist"
if DIST_DIR.exists():
    assets_dir = DIST_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Don't intercept API documentation
        if full_path.startswith("docs") or full_path.startswith("openapi.json") or full_path.startswith("redoc"):
            return None
        file_path = DIST_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(DIST_DIR / "index.html")
else:
    @app.get("/")
    async def root():
        return {
            "status": "healthy",
            "message": "AI Interview Simulator Backend API is running. (Run npm run build to serve frontend from root)",
            "docs": "/docs"
        }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    logger.info(f"Starting server on {host}:{port}")
    uvicorn.run("backend.app:app", host=host, port=port, reload=True)
