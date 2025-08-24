# Rev — Revolt Motors Voice (Gemini Live)
A minimal, server-to-server web app that replicates the Revolt voice bot behavior using the **Gemini Live API** (bidirectional WebSocket) with **Node.js/Express** on the backend. It supports **barge-in** (interrupt while the model is speaking), **low-latency** turn taking, and a simple, clean UI.

## Quick start
1. Create an API key: https://aistudio.google.com/app/apikey
2. Install
```bash
npm install
cp .env.example .env
# paste your key into GEMINI_API_KEY
```
3. Run
```bash
npm start
# open http://localhost:8080
```

## Notes
- Server-to-server: browser connects only to your server `/ws`; the server opens the Google Live API WS with header `x-goog-api-key`.
- Default model: `models/gemini-2.5-flash-preview-native-audio-dialog`.
- For testing use `models/gemini-2.0-flash-live-001` or `models/gemini-live-2.5-flash-preview` in `.env`.
- Mic is sent as **audio/pcm;rate=16000** (16-bit LE). Output plays at **24 kHz**.
- Interruption/barge-in works by default; UI cancels playback on the server's `interrupted` signal.
