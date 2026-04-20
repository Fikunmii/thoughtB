"""
transcribe.py — Whisper Audio Transcription Endpoint
------------------------------------------------------
A FastAPI server that accepts audio file uploads and returns
transcribed text using OpenAI's Whisper API.

This is the server-side fallback for browsers that don't support
the Web Speech Recognition API (Firefox, older Safari, etc.)

Usage:
    pip install fastapi uvicorn python-multipart openai python-dotenv
    python transcribe.py

Endpoints:
    POST /transcribe       — Upload audio, get transcript back
    GET  /health           — Check server status
"""

import os
import tempfile
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import openai

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Supported audio formats by Whisper
SUPPORTED_FORMATS = {
    "audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg",
    "audio/wav", "audio/x-wav", "audio/flac", "audio/m4a",
    "video/webm",  # Chrome records as video/webm even for audio-only
}

SUPPORTED_EXTENSIONS = {
    ".webm", ".ogg", ".mp3", ".mp4", ".wav", ".flac", ".m4a"
}

app = FastAPI(title="Thought Biography — Transcription Service")

# Allow requests from your frontend (adjust origin in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

client = openai.OpenAI(api_key=OPENAI_API_KEY)


@app.get("/health")
def health():
    return {"status": "ok", "whisper": "ready"}


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Accept an audio file upload and return its transcript.
    
    Request: multipart/form-data with 'file' field
    Response: { "transcript": "...", "duration_hint": "..." }
    """
    
    if not OPENAI_API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY not configured on server"
        )
    
    # Validate content type
    content_type = file.content_type or ""
    if content_type not in SUPPORTED_FORMATS:
        # Be lenient — check extension as fallback
        ext = Path(file.filename or "").suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported audio format: {content_type}. "
                       f"Supported: webm, ogg, mp3, mp4, wav, flac, m4a"
            )
    
    # Read file into memory
    audio_bytes = await file.read()
    
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file received")
    
    # Whisper has a 25MB limit
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="Audio file exceeds 25MB limit. Please record a shorter memo."
        )
    
    # Write to a temp file (Whisper API requires a file object)
    # Use the correct extension so Whisper knows the format
    ext = Path(file.filename or "audio.webm").suffix or ".webm"
    
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        
        # Call Whisper
        with open(tmp_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text",
                # Prompt helps Whisper understand it's personal reflection
                prompt=(
                    "This is a personal journal entry or voice memo. "
                    "The speaker may discuss philosophical ideas, personal reflections, "
                    "emotions, or abstract concepts. Transcribe accurately including "
                    "natural pauses and hesitations."
                )
            )
        
        transcript = response if isinstance(response, str) else response.text
        transcript = transcript.strip()
        
        if not transcript:
            raise HTTPException(
                status_code=422,
                detail="No speech detected in audio. Please try again."
            )
        
        word_count = len(transcript.split())
        
        return JSONResponse({
            "transcript": transcript,
            "word_count": word_count,
            "status": "success"
        })
    
    except openai.APIError as e:
        raise HTTPException(status_code=502, detail=f"Whisper API error: {str(e)}")
    
    finally:
        # Always clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    print("\n🎙  Thought Biography — Transcription Service")
    print("   Listening on http://localhost:8001")
    print("   POST /transcribe  — Upload audio → get transcript")
    print("   GET  /health      — Server status\n")
    uvicorn.run(app, host="0.0.0.0", port=8001)
