# Whisperly — Real-Time Streaming AI Voice Assistant 🎙️⚡

[![Live Demo](https://img.shields.io/badge/Live_Demo-Render-46E3B7?style=for-the-badge&logo=render&logoColor=white)](https://whisperly-ai-voice-assistance.onrender.com/)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Deepgram Nova-2](https://img.shields.io/badge/STT-Deepgram_Nova--2-13EF93?logo=deepgram&logoColor=black)](https://deepgram.com/)
[![Gemini 2.5 Flash](https://img.shields.io/badge/LLM-Gemini_2.5_Flash-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![ElevenLabs](https://img.shields.io/badge/TTS-ElevenLabs_Turbo-FF6B00?logo=elevenlabs&logoColor=white)](https://elevenlabs.io/)
[![SQLite](https://img.shields.io/badge/Database-SQLite_Native-003B57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 🌐 **Live Production App**: **[https://whisperly-ai-voice-assistance.onrender.com/](https://whisperly-ai-voice-assistance.onrender.com/)**

**Whisperly** is a state-of-the-art, low-latency streaming AI voice assistant. It continuously streams raw linear PCM microphone audio from an in-browser `AudioWorklet`, transcribes speech in real time with **Deepgram Nova-2**, streams conversational responses and autonomously executes tools via **Gemini 2.5 Flash**, synthesizes streaming voice output using **ElevenLabs Turbo v2.5**, and supports **instant sub-50ms barge-in interruptions**.

---

## 🚀 Key Highlights

- **🎙️ AudioWorklet Capture**: Custom high-performance audio processor downsampling and slicing mic input into 50ms chunks (1,600 bytes) of 16-bit 16kHz linear PCM at a steady 20 Hz.
- **⚡ Streaming Speech-to-Text**: Real-time interim hypotheses and turn endpointing powered by a persistent WebSocket connection to Deepgram Nova-2.
- **🧠 Autonomous Tool Layer**: Function-calling loop executing live Open-Meteo meteorological queries and persisting user reminders & notes in a local SQLite database (`node:sqlite`).
- **🔊 Pipelined Streaming TTS**: Pipelined sentence chunker streaming voice segments from ElevenLabs Turbo v2.5 with gapless Web Audio timeline scheduling.
- **🛑 Sub-50ms Barge-In**: Dual-path interruption engine (fast client-side VAD + server STT detection) cutting off local audio in **0ms** and aborting in-flight server streams via `AbortController` in **2ms**.
- **📊 Latency Waterfall Telemetry**: Visual real-time dashboard tracking stage-by-stage latencies: `[STT ms] -> [LLM TTFT ms] -> [TTS TTFA ms] = Total Roundtrip ms`.
- **✨ Wake Word Engine**: In-browser keyword spotting for *"Hey Whisperly"* with standby audio gating and a synthesized acoustic wake chime.

---

## 🏛️ End-to-End Pipeline Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ BROWSER CLIENT (http://localhost:5173)                                 │
│                                                                        │
│ 1. Wake Word Engine & Audio Gating (Phase 8):                          │
│    - Gating Modes: "Continuous Mic" vs "Wake Word Gated"               │
│    - Keyword Spotting: "Hey Whisperly" / "Hey Assistant"               │
│    - Web Audio Acoustic Wake Chime (F#5 -> B5)                         │
│                                                                        │
│ 2. Audio Capture Pipeline (Phase 1):                                   │
│    - AudioWorklet (16kHz 16-bit linear PCM, 50ms frames @ 20 Hz)       │
│    - Real-time VU meter with peak hold & HTML5 Canvas oscilloscope     │
│                                                                        │
│ 3. Live Dialogue & Transcripts (Phases 2 & 3):                         │
│    - Real-time interim speech hypotheses + finalized turns             │
│    - Streaming Assistant token-by-token replies with TTFT metrics      │
│                                                                        │
│ 4. Autonomous Tool Feed (Phase 4):                                     │
│    - Inline tool badges & live tool execution activity card            │
│                                                                        │
│ 5. Web Audio Playback Queue (Phases 5 & 7):                            │
│    - Streaming MP3 sentence chunks from ElevenLabs                     │
│    - Sample-accurate gapless scheduling with zero stutter              │
│    - Active Voice Playback HUD with animated equalizing wave bars      │
│                                                                        │
│ 6. Dual-Path Barge-In Interruption (Phase 6):                          │
│    - Local playback halted instantly in 0ms (< 50ms target)            │
│    - WebSocket {"type": "interrupt"} sent to server                    │
│                                                                        │
│ 7. Latency Waterfall Dashboard (Phase 7):                              │
│    - Visual progress bar: STT + LLM TTFT + TTS TTFA = Total Roundtrip  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Bidirectional WebSocket
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ NODE.JS BACKEND SERVER (ws://localhost:8080)                           │
│                                                                        │
│ 1. Binary Ingestion & Rate Engine:                                     │
│    Maintains steady ~31.25 KB/s throughput                             │
│                                                                        │
│ 2. Deepgram STT Streaming WebSocket:                                   │
│    Pipes 16kHz PCM to wss://api.deepgram.com/v1/listen (200ms endpoint)│
│                                                                        │
│ 3. SQLite Database Layer:                                              │
│    Native node:sqlite database storing reminders & notes               │
│                                                                        │
│ 4. Resilient Multi-Model Gemini Engine:                                │
│    Gemini 2.5 Flash / Flash-Lite with Claude 3.5 Haiku fallback        │
│                                                                        │
│ 5. Sentence Pipelining & ElevenLabs TTS:                               │
│    SentenceChunker splits on [. ! ? \n] -> streams to ElevenLabs Turbo │
│                                                                        │
│ 6. Instant Server Cancellation:                                        │
│    AbortController halts in-flight LLM & ElevenLabs streams in 2ms     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

| Component | Technology | Role |
|-----------|------------|------|
| **Client Frontend** | Vite, Vanilla JavaScript, CSS Glassmorphism | AudioWorklet mic capture, Web Audio playback, real-time HUD |
| **Backend Server** | Node.js (ESM), `ws` (WebSocket) | Audio routing, session management, turn orchestration |
| **Speech-to-Text (STT)** | Deepgram Nova-2 (`wss://api.deepgram.com`) | Streaming 16kHz linear PCM speech transcription |
| **Language Model (LLM)** | Google Gemini 2.5 Flash (`@google/genai`) | Function calling, tool dispatch, conversational streaming |
| **Database** | Node.js Native SQLite (`node:sqlite`) | Persistent reminders and personal notes storage |
| **Text-to-Speech (TTS)** | ElevenLabs Turbo v2.5 (`eleven_turbo_v2_5`) | Pipelined sentence synthesis (`Sarah` voice) |
| **Weather API** | Open-Meteo REST API | Real-time global meteorological forecasts |

---

## 📁 Repository Layout

```
whisperly/
├── client/                     # Vite Frontend Application
│   ├── public/
│   │   └── pcm-worker.js       # AudioWorklet 16kHz PCM audio processor
│   ├── index.html              # Glassmorphism UI, Visualizers & Latency Waterfall
│   ├── main.js                 # WebSocket client, Web Audio queue, Barge-in, Wake Word
│   ├── style.css               # Obsidian glassmorphism theme & animations
│   └── vite.config.js          # Vite configuration
│
├── server/                     # Backend WebSocket Server
│   ├── data/
│   │   └── assistant.db        # SQLite database (reminders & notes)
│   ├── services/
│   │   ├── deepgram.js         # Deepgram Nova-2 streaming WebSocket client
│   │   ├── llm.js              # Gemini / Claude streaming LLM with tool calling
│   │   ├── tools.js            # Tool execution handlers (Weather, Reminders, Notes)
│   │   └── tts.js              # SentenceChunker & ElevenLabs Turbo streaming TTS
│   ├── db.js                   # SQLite database schema & migrations
│   ├── index.js                # Main WebSocket server & turn-taking orchestrator
│   └── package.json            # Server dependencies
│
├── DEMO.md                     # 2-minute live demo presentation walkthrough script
├── phases.md                   # 8-phase specification & completion roadmap
├── project.md                  # System architecture & latency benchmarks
├── render.yaml                 # One-click cloud deployment config (Render)
├── Procfile                    # Railway / Heroku deployment descriptor
└── README.md                   # Project documentation
```

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js**: v20.0 or higher (v22+ recommended for native `node:sqlite`)
- **npm**: v10.0 or higher
- Microphone access in Chrome, Edge, Brave, or Firefox.

### 2. Clone the Repository
```bash
git clone https://github.com/rohan-kapadi/Whisperly---Ai-Voice-Assistance.git
cd Whisperly---Ai-Voice-Assistance
```

### 3. Install Dependencies
```bash
# Install dependencies for both server and client
cd server && npm install
cd ../client && npm install
cd ..
```

### 4. Configure API Keys
Create a `.env` file in the root directory (or copy from `.env.example`):
```env
PORT=8080

# Speech-to-Text (Deepgram)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# LLM Provider (Google Gemini)
GEMINI_API_KEY=your_gemini_api_key_here

# Text-to-Speech (ElevenLabs)
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL
ELEVENLABS_MODEL_ID=eleven_turbo_v2_5

# (Optional Fallbacks)
ANTHROPIC_API_KEY=your_anthropic_key_optional
```

> **API Key Tips**:
> - **Deepgram**: Get a free API key with $200 credits at [deepgram.com](https://deepgram.com/).
> - **Gemini**: Get a free API key at [ai.google.dev](https://aistudio.google.com/).
> - **ElevenLabs**: Free accounts include access to premade voices like Sarah (`EXAVITQu4vr4xnSDxMaL`) on `eleven_turbo_v2_5`.

---

## 🏃 Running the Application

### Start the WebSocket Server (Terminal 1)
```bash
cd server
npm start
```
The server will start listening on `ws://localhost:8080` (health check at `http://localhost:8080/health`).

### Start the Vite Client (Terminal 2)
```bash
cd client
npm run dev
```
The client UI will open at `http://localhost:5173`.

---

## 🎯 Supported Autonomous Tools

The assistant detects intent and invokes functions automatically:

| Tool Name | Example Spoken Trigger | Underlying Action |
|-----------|------------------------|-------------------|
| `get_weather` | *"What is the weather in Pune right now?"* | Fetches live temperature, weather condition, humidity, and wind speed from Open-Meteo. |
| `set_reminder` | *"Remind me to call mom tomorrow at 5 PM"* | Inserts a reminder into the local SQLite database. |
| `list_reminders` | *"What are my active reminders?"* | Queries active pending reminders from SQLite. |
| `add_note` | *"Add a note that the garage door code is 4821"* | Stores a note entry in the SQLite `notes` table. |
| `query_notes` | *"Search my notes for garage code"* | Queries stored notes via keyword matching. |

---

## ⚡ Latency Benchmarks & Verified Results

| Milestone | Metric | Target | Measured Result |
|-----------|--------|--------|-----------------|
| **Transport** | Ping-Pong WebSocket Latency | < 50 ms | **4 – 12 ms** |
| **Microphone Capture** | PCM Chunk Frequency | 20 chunks/s | **20.0 chunks/s (steady)** |
| **Speech-to-Text** | Deepgram Turn Finalization | < 500 ms | **200 – 320 ms** |
| **LLM Generation** | Gemini Time-to-First-Token (TTFT) | < 1000 ms | **550 – 750 ms** |
| **Text-to-Speech** | ElevenLabs Time-to-First-Audio (TTFA) | < 1500 ms | **700 – 900 ms** |
| **Barge-In Cut-off** | Local Web Audio Halt | < 50 ms | **0 ms (Instantaneous)** |
| **Barge-In Server Cancel** | In-flight Stream Abort | < 200 ms | **2 ms** |
| **Tool Calling** | Weather / SQLite Execution | < 800 ms | **200 – 350 ms** |

---

## 🎬 2-Minute Live Demo Presentation

See [`DEMO.md`](file:///c:/Rohan/Projects/voice%20Assistance/DEMO.md) for a comprehensive, step-by-step walkthrough covering:
1. **AudioWorklet Mic Streaming** (0:00 – 0:20)
2. **Real-Time STT & Streaming LLM** (0:20 – 0:45)
3. **Autonomous Tool Calling (Weather + SQLite DB)** (0:45 – 1:15)
4. **Mid-Speech Barge-In Interruption** (1:15 – 1:35)
5. **Latency Waterfall Telemetry Review** (1:35 – 2:00)

---

## 🌐 Cloud Deployment

### Live Deployment
The project is deployed and accessible at:
👉 **[https://whisperly-ai-voice-assistance.onrender.com/](https://whisperly-ai-voice-assistance.onrender.com/)**

### Deploy to Render
The repository includes an all-in-one [`render.yaml`](file:///c:/Rohan/Projects/voice%20Assistance/render.yaml) blueprint that builds and serves both the frontend UI and WebSocket backend from a single service:
1. Fork or push this repository to GitHub.
2. Log in to [Render](https://render.com/) and create a **New Blueprint Instance**.
3. Link your repository — Render will automatically read `render.yaml` and configure the Node.js web service.
4. Set your environment variables (`DEEPGRAM_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`) in the Render dashboard.

### Deploy to Railway / Heroku
The included [`Procfile`](file:///c:/Rohan/Projects/voice%20Assistance/Procfile) declares:
```text
web: node server/index.js
```
Simply connect your GitHub repo to Railway or Heroku and add your environment variables.

---

## 📄 License

This project is licensed under the **MIT License** — feel free to use, modify, and distribute it in your own projects.
