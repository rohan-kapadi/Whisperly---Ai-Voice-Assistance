// Real-Time Voice Assistant Client - Phase 3
// Audio Streaming + Deepgram STT + Streaming LLM Assistant Integration

const WS_URL = 'ws://localhost:8080';

// DOM Elements: Connection & Pipeline
const connectionPill = document.getElementById('connection-pill');
const connectionText = document.getElementById('connection-text');
const endpointDisplay = document.getElementById('endpoint-display');
const sessionDisplay = document.getElementById('session-display');
const latencyDisplay = document.getElementById('latency-display');
const stateDisplay = document.getElementById('state-display');
const logsContainer = document.getElementById('logs-container');
const logCountBadge = document.getElementById('log-count');

// DOM Elements: Microphone & Audio Capture
const btnMicToggle = document.getElementById('btn-mic-toggle');
const btnTestTone = document.getElementById('btn-test-tone');
const micToggleCaption = document.getElementById('mic-toggle-caption');
const micBadge = document.getElementById('mic-badge');
const vuMeterBar = document.getElementById('vu-meter-bar');
const vuMeterPeak = document.getElementById('vu-meter-peak');
const vuLevelValue = document.getElementById('vu-level-value');
const visualizerCanvas = document.getElementById('audio-visualizer');
const canvasCtx = visualizerCanvas ? visualizerCanvas.getContext('2d') : null;

// DOM Elements: Stream Stats
const statChunks = document.getElementById('stat-chunks');
const statBytes = document.getElementById('stat-bytes');
const statRate = document.getElementById('stat-rate');
const statDuration = document.getElementById('stat-duration');

// DOM Elements: STT & LLM Dialogue Feed (Phase 3)
const sttStatusBadge = document.getElementById('stt-status-badge');
const sttLatencyBadge = document.getElementById('stt-latency-badge');
const llmModelBadge = document.getElementById('llm-model-badge');
const llmTtftBadge = document.getElementById('llm-ttft-badge');
const liveInterimBox = document.getElementById('live-interim-box');
const interimText = document.getElementById('interim-text');
const transcriptFeed = document.getElementById('transcript-feed');
const transcriptEmpty = document.getElementById('transcript-empty');

// DOM Elements: Echo & Test Console
const echoForm = document.getElementById('echo-form');
const messageInput = document.getElementById('message-input');
const btnPing = document.getElementById('btn-ping');
const btnReconnect = document.getElementById('btn-reconnect');
const btnClearLogs = document.getElementById('btn-clear-logs');
const quickChips = document.querySelectorAll('.chip:not(#btn-test-tone)');

// Application State
let socket = null;
let logCount = 0;
let reconnectTimer = null;
let currentSessionId = null;

// Audio Capture State
let isRecording = false;
let isSimulated = false;
let simulatedAudioSource = null;
let audioContext = null;
let mediaStream = null;
let workletNode = null;
let analyserNode = null;
let animFrameId = null;

let audioChunksSent = 0;
let audioBytesSent = 0;
let streamStartTime = null;
let durationTimerInterval = null;
let peakEnergy = 0;

// Streaming Assistant State (Phase 3)
let activeAssistantCard = null;
let activeAssistantText = null;
let activeAssistantContent = '';

// Initialize
endpointDisplay.textContent = WS_URL;
connectWebSocket();
initVisualizerCanvas();

// ============================================================================
// Event Listeners
// ============================================================================

btnMicToggle.addEventListener('click', () => {
  if (isRecording) {
    stopAudioStreaming();
  } else {
    startMicrophone();
  }
});

if (btnTestTone) {
  btnTestTone.addEventListener('click', () => {
    if (isRecording) {
      stopAudioStreaming();
    } else {
      startSimulatedAudio();
    }
  });
}

echoForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;
  sendMessage(text);
  messageInput.value = '';
});

btnPing.addEventListener('click', () => {
  sendPing();
});

btnReconnect.addEventListener('click', () => {
  if (socket) {
    socket.close();
  }
  connectWebSocket();
});

btnClearLogs.addEventListener('click', () => {
  logsContainer.innerHTML = '';
  logCount = 0;
  logCountBadge.textContent = '0';
});

quickChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    const msg = chip.getAttribute('data-msg');
    if (msg) sendMessage(msg);
  });
});

// ============================================================================
// WebSocket Transport Logic
// ============================================================================

function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  updateConnectionStatus('connecting');
  addLog('sys', `Connecting to WebSocket server at ${WS_URL}...`);

  try {
    socket = new WebSocket(WS_URL);
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      updateConnectionStatus('connected');
      addLog('sys', `Connected to WebSocket server at ${WS_URL}`);
      sendPing();
    };

    socket.onmessage = (event) => {
      handleIncomingMessage(event.data);
    };

    socket.onclose = (event) => {
      updateConnectionStatus('disconnected');
      sessionDisplay.textContent = 'Disconnected';
      currentSessionId = null;
      if (isRecording) {
        stopAudioStreaming();
      }
      addLog('sys', `WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
    };

    socket.onerror = (err) => {
      addLog('err', `WebSocket connection error on ${WS_URL}`);
      console.error('WebSocket Error:', err);
    };
  } catch (error) {
    updateConnectionStatus('disconnected');
    addLog('err', `Failed to initialize WebSocket: ${error.message}`);
  }
}

// ============================================================================
// Phase 1 & 2: Audio Capture & Streaming to Deepgram STT
// ============================================================================

async function startMicrophone() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addLog('err', 'Cannot start mic: WebSocket is not connected.');
    return;
  }

  try {
    micToggleCaption.textContent = 'Requesting mic access...';

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx({ sampleRate: 16000 });
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    await audioContext.audioWorklet.addModule('/pcm-worker.js');

    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    setupAudioNodes(sourceNode);

    socket.send(JSON.stringify({ type: 'audio_start', sampleRate: 16000, channels: 1 }));

    isRecording = true;
    isSimulated = false;
    btnMicToggle.classList.add('recording');
    micBadge.textContent = 'LIVE MIC';
    micBadge.className = 'badge-live badge-active';
    micToggleCaption.textContent = 'Streaming to STT (Click to Stop)';
    stateDisplay.textContent = 'LISTENING';
    stateDisplay.className = 'info-badge state-idle';

    if (sttStatusBadge) {
      sttStatusBadge.textContent = 'LISTENING...';
      sttStatusBadge.className = 'badge-live badge-active';
    }

    streamStartTime = Date.now();
    startDurationTimer();
    startVisualizerLoop();

    addLog('sys', 'Microphone active. Streaming 16kHz PCM chunks to Deepgram Nova-2.');
  } catch (err) {
    console.error('Failed to start microphone:', err);
    addLog('err', `Microphone access note: ${err.message || 'No mic found'}. You can also use "⚡ Simulate Audio Stream" to test.`);
    stopAudioStreaming();
  }
}

async function startSimulatedAudio() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addLog('err', 'Cannot start simulation: WebSocket is not connected.');
    return;
  }

  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx({ sampleRate: 16000 });
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    await audioContext.audioWorklet.addModule('/pcm-worker.js');

    let audioBufferNode = null;
    try {
      const response = await fetch('/test-speech.wav');
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        const decoded = await audioContext.decodeAudioData(arrayBuf);
        audioBufferNode = audioContext.createBufferSource();
        audioBufferNode.buffer = decoded;
        audioBufferNode.loop = false;
        setupAudioNodes(audioBufferNode);
        audioBufferNode.start();
        simulatedAudioSource = audioBufferNode;

        audioBufferNode.onended = () => {
          console.log('[Simulated Audio] Finished playing speech audio.');
        };
      }
    } catch (e) {
      console.warn('Could not load test-speech.wav, falling back to synthesizer:', e);
    }

    if (!audioBufferNode) {
      const osc = audioContext.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(260, audioContext.currentTime);

      const lfo = audioContext.createOscillator();
      lfo.frequency.setValueAtTime(3, audioContext.currentTime);
      const lfoGain = audioContext.createGain();
      lfoGain.gain.setValueAtTime(0.35, audioContext.currentTime);

      const mainGain = audioContext.createGain();
      mainGain.gain.setValueAtTime(0.4, audioContext.currentTime);

      lfo.connect(mainGain.gain);
      osc.connect(mainGain);

      setupAudioNodes(mainGain);
      osc.start();
      lfo.start();
      simulatedAudioSource = { osc, lfo };
    }

    isSimulated = true;
    socket.send(JSON.stringify({ type: 'audio_start', sampleRate: 16000, channels: 1, simulated: true }));

    isRecording = true;
    btnMicToggle.classList.add('recording');
    micBadge.textContent = 'SIMULATED SPEECH';
    micBadge.className = 'badge-live badge-active';
    micToggleCaption.textContent = 'Simulating Speech Stream (Click to Stop)';
    if (btnTestTone) btnTestTone.textContent = '⏹ Stop Simulation';
    stateDisplay.textContent = 'LISTENING';
    stateDisplay.className = 'info-badge state-idle';

    if (sttStatusBadge) {
      sttStatusBadge.textContent = 'TRANSCRIBING...';
      sttStatusBadge.className = 'badge-live badge-active';
    }

    streamStartTime = Date.now();
    startDurationTimer();
    startVisualizerLoop();

    addLog('sys', 'Simulated speech stream active. Streaming PCM chunks to Deepgram Nova-2.');
  } catch (err) {
    console.error('Failed to start audio simulation:', err);
    addLog('err', `Simulation error: ${err.message}`);
    stopAudioStreaming();
  }
}

function setupAudioNodes(inputSourceNode) {
  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 64;
  analyserNode.smoothingTimeConstant = 0.8;

  workletNode = new AudioWorkletNode(audioContext, 'pcm-recorder-processor');

  inputSourceNode.connect(analyserNode);
  inputSourceNode.connect(workletNode);

  const muteGain = audioContext.createGain();
  muteGain.gain.value = 0;
  workletNode.connect(muteGain);
  muteGain.connect(audioContext.destination);

  workletNode.port.onmessage = (event) => {
    if (event.data.type === 'pcm_chunk') {
      const { pcmData, rms } = event.data;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(pcmData);
        audioChunksSent++;
        audioBytesSent += pcmData.byteLength;
        updateAudioStatsUI();
      }
      updateVuMeter(rms);
    }
  };
}

function stopAudioStreaming() {
  if (!isRecording && !mediaStream && !simulatedAudioSource) return;

  isRecording = false;

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (simulatedAudioSource) {
    try {
      if (simulatedAudioSource.stop) {
        simulatedAudioSource.stop();
      } else if (simulatedAudioSource.osc) {
        simulatedAudioSource.osc.stop();
        simulatedAudioSource.lfo.stop();
      }
    } catch {}
    simulatedAudioSource = null;
    isSimulated = false;
  }
  if (btnTestTone) btnTestTone.textContent = '⚡ Simulate Audio Stream';

  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close().catch(() => {});
    audioContext = null;
  }

  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (durationTimerInterval) {
    clearInterval(durationTimerInterval);
    durationTimerInterval = null;
  }

  updateVuMeter(0);
  drawIdleVisualizer();

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'audio_stop' }));
  }

  btnMicToggle.classList.remove('recording');
  micBadge.textContent = 'MUTED';
  micBadge.className = 'badge-live badge-inactive';
  micToggleCaption.textContent = 'Click to Start Mic';
  stateDisplay.textContent = 'CONNECTED';

  addLog(
    'sys',
    `Audio stream stopped. Total sent: ${audioChunksSent} chunks (${(audioBytesSent / 1024).toFixed(1)} KB).`
  );
}

// ============================================================================
// Phase 2 & 3: Speech Transcript & Assistant Dialogue Handlers
// ============================================================================

function handleSttInterim(payload) {
  if (!payload.text) return;

  if (liveInterimBox) {
    liveInterimBox.classList.remove('hidden');
  }
  if (interimText) {
    interimText.textContent = payload.text;
  }
  if (sttStatusBadge) {
    sttStatusBadge.textContent = 'LISTENING...';
    sttStatusBadge.className = 'badge-live badge-active';
  }
  if (sttLatencyBadge && payload.latencyMs) {
    sttLatencyBadge.textContent = `STT: ${payload.latencyMs} ms`;
  }
}

function handleSttFinal(payload) {
  if (!payload.text) return;

  if (liveInterimBox) {
    liveInterimBox.classList.add('hidden');
  }
  if (interimText) {
    interimText.textContent = '';
  }

  if (sttStatusBadge) {
    sttStatusBadge.textContent = 'FINALIZED';
    sttStatusBadge.className = 'badge-live badge-active';
  }

  if (sttLatencyBadge && payload.latencyMs) {
    sttLatencyBadge.textContent = `STT: ${payload.latencyMs} ms`;
  }

  if (transcriptEmpty) {
    transcriptEmpty.style.display = 'none';
  }

  if (transcriptFeed) {
    const item = document.createElement('div');
    item.className = 'transcript-item';

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    const latencyTag = payload.latencyMs ? `${payload.latencyMs}ms` : '<300ms';

    item.innerHTML = `
      <div class="transcript-item-meta">
        <span class="speaker-tag">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          You (Spoken)
        </span>
        <span class="transcript-item-time">${timeStr} · ${latencyTag}</span>
      </div>
      <p class="transcript-item-text">${escapeHtml(payload.text)}</p>
    `;

    transcriptFeed.appendChild(item);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
  }

  addLog('in', `[STT Final]: "${payload.text}" (${payload.latencyMs || 0}ms)`);
}

function handleSpeechFinal(payload) {
  if (liveInterimBox) {
    liveInterimBox.classList.add('hidden');
  }
  if (sttStatusBadge) {
    sttStatusBadge.textContent = 'TURN END';
  }
  addLog('sys', `Turn completion detected. Initiating LLM generation.`);
}

// ============================================================================
// Phase 3: Assistant Streaming Token Handlers
// ============================================================================

function handleAssistantStart(payload) {
  if (sttStatusBadge) {
    sttStatusBadge.textContent = 'THINKING...';
    sttStatusBadge.className = 'badge-live badge-active';
  }

  if (transcriptEmpty) {
    transcriptEmpty.style.display = 'none';
  }

  if (transcriptFeed) {
    const item = document.createElement('div');
    item.className = 'transcript-item assistant streaming';

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    item.innerHTML = `
      <div class="transcript-item-meta">
        <span class="speaker-tag assistant-tag">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2a10 10 0 1 0 10 10H12V2Z"></path>
            <path d="M12 12 2.1 10.5"></path>
            <path d="M12 12V22"></path>
          </svg>
          Assistant (Streaming)
        </span>
        <span class="transcript-item-time">${timeStr}</span>
      </div>
      <p class="transcript-item-text streaming-text"></p>
    `;

    transcriptFeed.appendChild(item);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;

    activeAssistantCard = item;
    activeAssistantText = item.querySelector('.transcript-item-text');
    activeAssistantContent = '';
  }

  addLog('in', `[LLM Start] Assistant generation started.`);
}

function handleAssistantDelta(payload) {
  if (sttStatusBadge) {
    sttStatusBadge.textContent = 'SPEAKING';
    sttStatusBadge.className = 'badge-live badge-active';
  }

  if (payload.ttftMs && llmTtftBadge) {
    llmTtftBadge.textContent = `TTFT: ${payload.ttftMs} ms`;
  }

  if (activeAssistantText && payload.delta) {
    activeAssistantContent += payload.delta;
    activeAssistantText.textContent = activeAssistantContent;
    if (transcriptFeed) transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
  }
}

function handleAssistantDone(payload) {
  if (sttStatusBadge) {
    sttStatusBadge.textContent = 'READY';
    sttStatusBadge.className = 'badge-live badge-inactive';
  }

  if (payload.ttftMs && llmTtftBadge) {
    llmTtftBadge.textContent = `TTFT: ${payload.ttftMs} ms`;
  }

  if (payload.model && llmModelBadge) {
    llmModelBadge.textContent = payload.model;
  }

  if (activeAssistantCard) {
    activeAssistantCard.classList.remove('streaming');
    const speakerTag = activeAssistantCard.querySelector('.speaker-tag');
    if (speakerTag) {
      speakerTag.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a10 10 0 1 0 10 10H12V2Z"></path>
          <path d="M12 12 2.1 10.5"></path>
          <path d="M12 12V22"></path>
        </svg>
        Assistant (${payload.model || 'Gemini 2.5 Flash'})
      `;
    }
    const timeSpan = activeAssistantCard.querySelector('.transcript-item-time');
    if (timeSpan) {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      timeSpan.textContent = `${timeStr} · TTFT ${payload.ttftMs}ms · Total ${payload.totalMs}ms`;
    }
  }

  if (activeAssistantText) {
    activeAssistantText.classList.remove('streaming-text');
    activeAssistantText.textContent = payload.fullText || activeAssistantContent;
  }

  addLog('in', `[LLM Complete]: "${payload.fullText}" (TTFT: ${payload.ttftMs}ms, Total: ${payload.totalMs}ms)`);

  activeAssistantCard = null;
  activeAssistantText = null;
  activeAssistantContent = '';
}

function handleAssistantError(payload) {
  if (sttStatusBadge) {
    sttStatusBadge.textContent = 'LLM ERROR';
    sttStatusBadge.className = 'badge-live badge-inactive';
  }

  if (activeAssistantText) {
    activeAssistantText.classList.remove('streaming-text');
    activeAssistantText.textContent = `[Error: ${payload.message}]`;
  }

  addLog('err', `[LLM Error]: ${payload.message}`);

  activeAssistantCard = null;
  activeAssistantText = null;
  activeAssistantContent = '';
}

// ============================================================================
// Live Waveform & VU Meter
// ============================================================================

function updateVuMeter(rms) {
  const scaled = Math.min(100, Math.round(Math.pow(rms * 4.5, 0.75) * 100));
  vuMeterBar.style.width = `${scaled}%`;
  vuLevelValue.textContent = `${scaled}%`;

  if (scaled >= peakEnergy) {
    peakEnergy = scaled;
    vuMeterPeak.style.left = `${peakEnergy}%`;
  } else {
    peakEnergy = Math.max(0, peakEnergy - 1.5);
    vuMeterPeak.style.left = `${peakEnergy}%`;
  }
}

function updateAudioStatsUI() {
  statChunks.textContent = audioChunksSent.toLocaleString();
  const totalKB = (audioBytesSent / 1024).toFixed(1);
  statBytes.textContent = `${totalKB} KB`;

  if (streamStartTime) {
    const elapsedSec = (Date.now() - streamStartTime) / 1000;
    if (elapsedSec > 0.5) {
      const rateKB = (audioBytesSent / 1024 / elapsedSec).toFixed(1);
      statRate.textContent = `${rateKB} KB/s`;
    }
  }
}

function startDurationTimer() {
  if (durationTimerInterval) clearInterval(durationTimerInterval);
  durationTimerInterval = setInterval(() => {
    if (!streamStartTime) return;
    const elapsed = Math.floor((Date.now() - streamStartTime) / 1000);
    const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const secs = String(elapsed % 60).padStart(2, '0');
    statDuration.textContent = `${mins}:${secs}`;
  }, 1000);
}

function initVisualizerCanvas() {
  if (!visualizerCanvas) return;
  visualizerCanvas.width = visualizerCanvas.parentElement.clientWidth || 380;
  visualizerCanvas.height = 52;
  drawIdleVisualizer();
}

function drawIdleVisualizer() {
  if (!canvasCtx || !visualizerCanvas) return;
  const w = visualizerCanvas.width;
  const h = visualizerCanvas.height;

  canvasCtx.clearRect(0, 0, w, h);
  canvasCtx.strokeStyle = 'rgba(99, 102, 241, 0.2)';
  canvasCtx.lineWidth = 2;
  canvasCtx.beginPath();
  canvasCtx.moveTo(0, h / 2);
  canvasCtx.lineTo(w, h / 2);
  canvasCtx.stroke();
}

function startVisualizerLoop() {
  if (!analyserNode || !canvasCtx || !visualizerCanvas) return;

  const bufferLength = analyserNode.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  function render() {
    if (!isRecording) return;
    animFrameId = requestAnimationFrame(render);

    analyserNode.getByteFrequencyData(dataArray);

    const w = visualizerCanvas.width;
    const h = visualizerCanvas.height;

    canvasCtx.clearRect(0, 0, w, h);

    const barWidth = (w / bufferLength) * 1.6;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * (h - 6) + 2;

      const gradient = canvasCtx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, '#06b6d4');
      gradient.addColorStop(0.7, '#6366f1');
      gradient.addColorStop(1, '#ec4899');

      canvasCtx.fillStyle = gradient;
      canvasCtx.fillRect(x, h - barHeight, barWidth - 1, barHeight);

      x += barWidth;
    }
  }

  render();
}

// ============================================================================
// Message & Protocol Handling
// ============================================================================

function sendMessage(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addLog('err', 'Cannot send message: WebSocket is not connected.');
    return;
  }

  let dataToSend;
  let displayContent;

  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      dataToSend = JSON.stringify(parsed);
      displayContent = JSON.stringify(parsed);
    } catch {
      dataToSend = JSON.stringify({ type: 'text', content: payload, timestamp: Date.now() });
      displayContent = dataToSend;
    }
  } else if (payload && typeof payload === 'object') {
    dataToSend = JSON.stringify(payload);
    displayContent = dataToSend;
  } else {
    dataToSend = JSON.stringify({ type: 'text', content: String(payload), timestamp: Date.now() });
    displayContent = dataToSend;
  }

  socket.send(dataToSend);
  addLog('out', displayContent);
}

function sendPing() {
  const pingPayload = {
    type: 'ping',
    timestamp: Date.now()
  };
  sendMessage(pingPayload);
}

function handleIncomingMessage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { type: 'raw', content: raw };
  }

  console.log('[WS Incoming]:', parsed);

  // Phase 0: Connection Handshake
  if (parsed.type === 'connected') {
    currentSessionId = parsed.sessionId;
    sessionDisplay.textContent = `${currentSessionId.slice(0, 12)}...`;
    if (parsed.llmProvider && llmModelBadge) {
      llmModelBadge.textContent = parsed.llmProvider === 'gemini' ? 'Gemini 2.5 Flash' : 'Claude 3.5 Haiku';
    }
    addLog('in', `Handshake verified. Session: ${currentSessionId}`);
    return;
  }

  // Phase 0: Ping/Pong Latency
  if (parsed.type === 'pong') {
    const roundtrip = Date.now() - parsed.clientTime;
    latencyDisplay.textContent = `${roundtrip} ms`;
    addLog('in', `PONG received | Roundtrip latency: ${roundtrip}ms`);
    return;
  }

  // Phase 0: Echo Responses
  if (parsed.type === 'echo') {
    addLog('in', `ECHO: ${JSON.stringify(parsed.received)}`);
    return;
  }

  // Phase 1: Audio Rate Statistics from Server
  if (parsed.type === 'audio_stats') {
    statRate.textContent = `${parsed.rateKBps} KB/s`;
    return;
  }

  if (parsed.type === 'audio_stopped') {
    addLog('sys', `Server confirmed stream end: ${parsed.totalChunks} chunks received (${parsed.totalKB} KB)`);
    return;
  }

  // Phase 2: Deepgram Speech-to-Text Events
  if (parsed.type === 'stt_ready') {
    if (sttStatusBadge) {
      sttStatusBadge.textContent = 'DEEPGRAM LIVE';
      sttStatusBadge.className = 'badge-live badge-active';
    }
    addLog('sys', `Deepgram Nova-2 streaming connection active.`);
    return;
  }

  if (parsed.type === 'stt_interim') {
    handleSttInterim(parsed);
    return;
  }

  if (parsed.type === 'stt_final') {
    handleSttFinal(parsed);
    return;
  }

  if (parsed.type === 'speech_final') {
    handleSpeechFinal(parsed);
    return;
  }

  if (parsed.type === 'stt_error') {
    if (sttStatusBadge) {
      sttStatusBadge.textContent = 'STT ERROR';
      sttStatusBadge.className = 'badge-live badge-inactive';
    }
    addLog('err', `Deepgram Error: ${parsed.message}`);
    return;
  }

  // Phase 3: Streaming LLM Events
  if (parsed.type === 'assistant_start') {
    handleAssistantStart(parsed);
    return;
  }

  if (parsed.type === 'assistant_delta') {
    handleAssistantDelta(parsed);
    return;
  }

  if (parsed.type === 'assistant_done') {
    handleAssistantDone(parsed);
    return;
  }

  if (parsed.type === 'assistant_error') {
    handleAssistantError(parsed);
    return;
  }

  addLog('in', typeof raw === 'string' ? raw : JSON.stringify(parsed));
}

// UI Helpers
function updateConnectionStatus(status) {
  connectionPill.className = `status-pill status-${status}`;

  if (status === 'connected') {
    connectionText.textContent = 'Connected';
    stateDisplay.textContent = 'CONNECTED';
    stateDisplay.className = 'info-badge state-idle';
  } else if (status === 'connecting') {
    connectionText.textContent = 'Connecting...';
    stateDisplay.textContent = 'CONNECTING';
    stateDisplay.className = 'info-badge';
  } else {
    connectionText.textContent = 'Disconnected';
    stateDisplay.textContent = 'OFFLINE';
    stateDisplay.className = 'info-badge';
    latencyDisplay.textContent = '-- ms';
  }
}

function addLog(type, content) {
  logCount++;
  logCountBadge.textContent = logCount;

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

  const item = document.createElement('div');
  item.className = 'log-item';

  const badgeClass = type === 'in' ? 'log-in' : type === 'out' ? 'log-out' : type === 'err' ? 'log-err' : 'log-sys';
  const badgeLabel = type === 'in' ? 'IN' : type === 'out' ? 'OUT' : type === 'err' ? 'ERR' : 'SYS';

  item.innerHTML = `
    <span class="log-time">${timeStr}</span>
    <span class="log-badge ${badgeClass}">${badgeLabel}</span>
    <span class="log-content">${escapeHtml(content)}</span>
  `;

  logsContainer.appendChild(item);
  logsContainer.scrollTop = logsContainer.scrollHeight;
}

function escapeHtml(str) {
  if (typeof str !== 'string') str = JSON.stringify(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
