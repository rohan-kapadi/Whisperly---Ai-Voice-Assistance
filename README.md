# Real-Time Voice Assistant 🎙️

A low-latency, streaming voice assistant that listens as the user talks, understands spoken commands, calls real tools (reminders, weather, SQLite database), speaks the results back, and gracefully handles interruptions (barge-in).

## Architecture Overview

```
[Browser Mic] --PCM/Opus audio--> [WebSocket Server :8080]
                                         |
                                         v
                               [Streaming STT (Deepgram)]
                                         |
                                (partial + final text)
                                         v
                            [Turn/VAD endpointing logic]
                                         |
                                         v
                         [LLM (Claude / GPT-4o)] --calls--> [Tool Layer]
                                         |                 (reminders DB,
                                         |                  weather API,
                                         |                  notes DB)
                                         v
                           [Streaming TTS (ElevenLabs)]
                                         |
                               (audio chunks over WS)
                                         v
                               [Browser audio playback]
                                         ^
                                         |
                         [Barge-in: local mic energy
                          interrupts assistant audio]
```

---

## Project Structure

```
.
├── .env.example        # Environment variable template
├── package.json        # Root automation scripts
├── phases.md           # Implementation milestone checkpoints
├── project.md          # Full project design and latency specification
├── client/             # Frontend application (Vite + Vanilla JS + CSS)
│   ├── index.html      # Voice Assistant UI and HUD
│   ├── style.css       # Obsidian dark theme and glassmorphism design
│   ├── main.js         # WebSocket audio and event orchestrator
│   └── vite.config.js  # Vite server configuration
└── server/             # Backend WebSocket server (Node.js 24 ESM)
    ├── index.js        # Main WebSocket server and session management
    └── package.json    # Server dependencies (ws, dotenv)
```

---

## Prerequisites

- **Node.js**: v20 or higher (v24+ recommended)
- **npm**: v10 or higher
- Modern Chromium-based browser (Chrome, Edge, Brave) or Firefox with microphone access.

---

## Setup Instructions

### 1. Configure Environment Variables
Copy the `.env.example` file to `.env` in the root directory:
```bash
cp .env.example .env
```
Populate your API keys:
- `DEEPGRAM_API_KEY` (for Phase 2 Streaming STT)
- `ELEVENLABS_API_KEY` & `ELEVENLABS_VOICE_ID` (for Phase 5 Streaming TTS)
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (for Phase 3 LLM and Phase 4 Tools)

### 2. Install Dependencies
Run the installation script from the root:
```bash
npm run install:all
```
Or install in each directory individually:
```bash
cd server && npm install
cd ../client && npm install
```

### 3. Run the Development Servers

In terminal 1 (start the WebSocket server):
```bash
npm run dev:server
```
The server will start listening at `ws://localhost:8080` (health check at `http://localhost:8080/health`).

In terminal 2 (start the Client UI):
```bash
npm run dev:client
```
The client will be served at `http://localhost:5173`.

---

## Phase 0 Checkpoint Verification

1. Open `http://localhost:5173` in your browser.
2. Verify the status pill displays **Connected** with a pulsing green indicator.
3. Click **"Send Ping"** or type a message in the input box and click **"Send"**.
4. Check both the UI event log and browser DevTools console (`F12`) to see the server echo the message back in real time.
