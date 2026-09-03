import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { DeepgramLiveStream } from './services/deepgram.js';
import { LLMService } from './services/llm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root or server folder
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Initialize LLM service (Gemini primary, Anthropic fallback)
const llmService = new LLMService();

// Create standard HTTP server for health check & upgrading to WebSocket
const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Voice Assistant WebSocket Server is running.');
});

const wss = new WebSocketServer({ server });

console.log(`\n======================================================`);
console.log(`🎙️  REAL-TIME VOICE ASSISTANT SERVER (Phase 3 — LLM Streaming)`);
console.log(`======================================================`);
console.log(`STT Provider: Deepgram nova-2 (${process.env.DEEPGRAM_API_KEY ? 'API Key configured ✓' : 'NO KEY FOUND ✗'})`);
console.log(`LLM Provider: ${llmService.preferredProvider.toUpperCase()}`);

// Track active client sessions
const sessions = new Map();

/**
 * Triggers LLM generation for a completed user turn
 */
async function triggerLLMTurn(sessionData, sessionId, ws) {
  if (sessionData.silenceTimer) {
    clearTimeout(sessionData.silenceTimer);
    sessionData.silenceTimer = null;
  }

  const userText = sessionData.currentUtterance.trim();
  if (!userText || sessionData.isGenerating) return;

  sessionData.isGenerating = true;
  sessionData.currentUtterance = '';

  // Add user message to conversation history
  sessionData.history.push({ role: 'user', content: userText });
  console.log(`\n[LLM Turn START] Session ${sessionId.slice(0, 8)} User: "${userText}"`);

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        type: 'assistant_start',
        prompt: userText,
        timestamp: Date.now()
      })
    );
  }

  await llmService.streamResponse({
    messages: sessionData.history,
    onStart: () => {},
    onDelta: (delta, { ttftMs, elapsedMs }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'assistant_delta',
            delta,
            ttftMs,
            elapsedMs
          })
        );
      }
    },
    onComplete: ({ fullText, ttftMs, totalMs, provider, model }) => {
      sessionData.isGenerating = false;
      sessionData.history.push({ role: 'assistant', content: fullText });
      console.log(`[LLM Turn DONE] Session ${sessionId.slice(0, 8)} (${provider} TTFT: ${ttftMs}ms, Total: ${totalMs}ms)`);
      console.log(`Assistant: "${fullText}"\n`);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'assistant_done',
            fullText,
            ttftMs,
            totalMs,
            provider,
            model
          })
        );
      }
    },
    onError: (err) => {
      sessionData.isGenerating = false;
      console.error(`[LLM Error] Session ${sessionId.slice(0, 8)}:`, err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'assistant_error',
            message: err.message
          })
        );
      }
    }
  });
}

function scheduleTurnFallback(sessionData, sessionId, ws) {
  if (sessionData.silenceTimer) clearTimeout(sessionData.silenceTimer);
  sessionData.silenceTimer = setTimeout(() => {
    if (sessionData.currentUtterance.trim().length > 0 && !sessionData.isGenerating) {
      console.log(`[Turn Detector] Silence timeout reached for session ${sessionId.slice(0, 8)}`);
      triggerLLMTurn(sessionData, sessionId, ws);
    }
  }, 750);
}

function getOrCreateDeepgram(sessionData, sessionId, ws) {
  if (sessionData.deepgram && sessionData.deepgram.isConnected) {
    return sessionData.deepgram;
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey || apiKey === 'your_deepgram_api_key_here') {
    console.warn(`[Deepgram] No valid DEEPGRAM_API_KEY configured.`);
    return null;
  }

  if (sessionData.deepgram) {
    return sessionData.deepgram;
  }

  const deepgram = new DeepgramLiveStream(apiKey, {
    model: 'nova-2',
    endpointing: 300,
    sampleRate: 16000
  });

  deepgram.on('open', () => {
    console.log(`[Deepgram STT] Live connection established for session ${sessionId.slice(0, 8)}`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'stt_ready', provider: 'deepgram', model: 'nova-2' }));
    }
  });

  deepgram.on('interim', (data) => {
    sessionData.currentUtterance = data.text;
    console.log(`[STT Interim] ${sessionId.slice(0, 8)}: "${data.text}" (${data.latencyMs}ms)`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'stt_interim',
          text: data.text,
          confidence: data.confidence,
          latencyMs: data.latencyMs,
          timestamp: Date.now()
        })
      );
    }
  });

  deepgram.on('final', (data) => {
    sessionData.currentUtterance = data.text;
    console.log(`[STT Final] ${sessionId.slice(0, 8)}: "${data.text}" (${data.latencyMs}ms)`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'stt_final',
          text: data.text,
          confidence: data.confidence,
          speechFinal: data.speechFinal,
          latencyMs: data.latencyMs,
          timestamp: Date.now()
        })
      );
    }

    // Arm turn-end fallback timer if speech_final is delayed
    scheduleTurnFallback(sessionData, sessionId, ws);
  });

  deepgram.on('speech_final', (data) => {
    if (data.text) {
      sessionData.currentUtterance = data.text;
    }
    console.log(`[STT Turn End] ${sessionId.slice(0, 8)}: speech_final triggered (${data.latencyMs}ms)`);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'speech_final',
          text: sessionData.currentUtterance,
          latencyMs: data.latencyMs,
          timestamp: Date.now()
        })
      );
    }

    // Trigger LLM turn immediately upon speech_final endpointing
    triggerLLMTurn(sessionData, sessionId, ws);
  });

  deepgram.on('error', (err) => {
    console.error(`[Deepgram Error] ${sessionId.slice(0, 8)}:`, err.message);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'stt_error',
          message: err.message
        })
      );
    }
  });

  deepgram.on('close', ({ code, reason }) => {
    console.log(`[Deepgram Closed] ${sessionId.slice(0, 8)}: code ${code} (${reason || 'clean'})`);
  });

  deepgram.start();
  sessionData.deepgram = deepgram;
  return deepgram;
}

wss.on('connection', (ws, req) => {
  const sessionId = crypto.randomUUID();
  const clientIp = req.socket.remoteAddress;
  const connectedAt = new Date().toISOString();

  const sessionData = {
    ws,
    connectedAt,
    deepgram: null,
    history: [],
    currentUtterance: '',
    isGenerating: false,
    silenceTimer: null,
    audioStats: {
      totalChunks: 0,
      totalBytes: 0,
      streamStartTime: null,
      lastChunkTime: null,
      lastLogTime: 0,
      windowChunks: 0,
      windowBytes: 0
    }
  };
  sessions.set(sessionId, sessionData);

  console.log(`\n[+] Client connected | Session: ${sessionId.slice(0, 8)}... | IP: ${clientIp}`);

  // Send initial handshake acknowledgement
  const welcomePayload = {
    type: 'connected',
    sessionId,
    message: 'Connected to Real-Time Voice Assistant Server',
    serverTime: connectedAt,
    llmProvider: llmService.preferredProvider,
    supportedTypes: ['ping', 'echo', 'text', 'binary_audio', 'stt', 'chat']
  };
  ws.send(JSON.stringify(welcomePayload));

  ws.on('message', (data, isBinary) => {
    // Handle binary data (16kHz Raw PCM Audio Frames)
    if (isBinary) {
      const byteLength = data.byteLength || data.length;
      const now = Date.now();
      const stats = sessionData.audioStats;

      if (!stats.streamStartTime) {
        stats.streamStartTime = now;
        stats.lastLogTime = now;
        console.log(`\n[Audio Stream START] Session ${sessionId.slice(0, 8)} started transmitting audio.`);
      }

      stats.totalChunks++;
      stats.totalBytes += byteLength;
      stats.windowChunks++;
      stats.windowBytes += byteLength;
      stats.lastChunkTime = now;

      // Pipe PCM audio frame to Deepgram STT engine
      const dg = getOrCreateDeepgram(sessionData, sessionId, ws);
      if (dg) {
        dg.sendAudio(data);
      }

      // Log audio rate at steady 1-second intervals
      const timeSinceLastLog = now - stats.lastLogTime;
      if (timeSinceLastLog >= 1000) {
        const elapsedSec = timeSinceLastLog / 1000;
        const chunksPerSec = (stats.windowChunks / elapsedSec).toFixed(1);
        const kbPerSec = (stats.windowBytes / 1024 / elapsedSec).toFixed(1);
        const totalKB = (stats.totalBytes / 1024).toFixed(1);

        console.log(
          `[Audio Stream] Session ${sessionId.slice(0, 8)} | ${chunksPerSec} chunks/s | ${kbPerSec} KB/s | Frame: ${byteLength}B | Total: ${totalKB} KB`
        );

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'audio_stats',
              chunks: stats.totalChunks,
              totalKB: parseFloat(totalKB),
              rateKBps: parseFloat(kbPerSec),
              rateChunksSec: parseFloat(chunksPerSec),
              frameSize: byteLength
            })
          );
        }

        stats.windowChunks = 0;
        stats.windowBytes = 0;
        stats.lastLogTime = now;
      }
      return;
    }

    // Handle text / JSON frames
    const messageStr = data.toString('utf-8');
    let parsed;
    try {
      parsed = JSON.parse(messageStr);
    } catch {
      parsed = { type: 'raw_text', text: messageStr };
    }

    if (!parsed || typeof parsed !== 'object') {
      parsed = { type: 'raw_text', text: String(messageStr) };
    }

    console.log(`[Message] From ${sessionId.slice(0, 8)}:`, parsed);

    try {
      if (parsed.type === 'ping') {
        ws.send(
          JSON.stringify({
            type: 'pong',
            clientTime: parsed.timestamp,
            serverTime: Date.now(),
            latencyEstimateMs: parsed.timestamp ? Date.now() - parsed.timestamp : undefined
          })
        );
      } else if (parsed.type === 'audio_start') {
        console.log(`[Audio Control] Session ${sessionId.slice(0, 8)} initialized audio streaming.`);
        getOrCreateDeepgram(sessionData, sessionId, ws);
        ws.send(JSON.stringify({ type: 'audio_ready', sampleRate: 16000, channels: 1 }));
      } else if (parsed.type === 'audio_stop') {
        const stats = sessionData.audioStats;
        const totalKB = (stats.totalBytes / 1024).toFixed(1);
        console.log(
          `[Audio Stream STOP] Session ${sessionId.slice(0, 8)} stopped. Total streamed: ${totalKB} KB across ${stats.totalChunks} chunks.`
        );

        if (sessionData.deepgram) {
          sessionData.deepgram.stop();
          sessionData.deepgram = null;
        }

        // If there is pending finalized user text when mic stops, trigger LLM
        if (sessionData.currentUtterance.trim().length > 0 && !sessionData.isGenerating) {
          triggerLLMTurn(sessionData, sessionId, ws);
        }

        ws.send(
          JSON.stringify({
            type: 'audio_stopped',
            totalChunks: stats.totalChunks,
            totalKB: parseFloat(totalKB)
          })
        );
      } else if (parsed.type === 'chat') {
        // Direct text test to LLM
        sessionData.currentUtterance = parsed.text || parsed.content || '';
        triggerLLMTurn(sessionData, sessionId, ws);
      } else {
        // General echo response
        ws.send(
          JSON.stringify({
            type: 'echo',
            received: parsed,
            sessionId,
            serverTime: new Date().toISOString()
          })
        );
      }
    } catch (handlerErr) {
      console.error(`[Error] Handling message from ${sessionId.slice(0, 8)}:`, handlerErr);
    }
  });

  ws.on('close', (code, reason) => {
    const stats = sessionData.audioStats;
    console.log(
      `[-] Client disconnected | Session: ${sessionId.slice(0, 8)} | Code: ${code} | Total Audio: ${(stats.totalBytes / 1024).toFixed(1)} KB`
    );

    if (sessionData.silenceTimer) {
      clearTimeout(sessionData.silenceTimer);
    }

    if (sessionData.deepgram) {
      sessionData.deepgram.stop();
      sessionData.deepgram = null;
    }

    sessions.delete(sessionId);
  });

  ws.on('error', (err) => {
    console.error(`[!] WebSocket error on session ${sessionId.slice(0, 8)}:`, err.message);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server listening on ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`🩺 Health check available at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
  console.log(`⚡ Ready for streaming audio, STT transcription, and LLM text replies.\n`);
});
