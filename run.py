import sys
import uvicorn

if __name__ == "__main__":
    print("Starting AI Interview Simulator Backend on http://127.0.0.1:8000 ...")
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=True)
