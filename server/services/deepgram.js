import { WebSocket } from 'ws';
import { EventEmitter } from 'node:events';

/**
 * DeepgramLiveStream
 * Manages a streaming WebSocket connection to Deepgram's nova-2 model.
 * Ingests 16kHz 16-bit linear PCM audio chunks and emits real-time
 * interim, final, and speech_final transcription events.
 */
export class DeepgramLiveStream extends EventEmitter {
  constructor(apiKey, options = {}) {
    super();
    this.apiKey = apiKey;
    this.model = options.model || 'nova-2';
    this.language = options.language || 'en';
    this.sampleRate = options.sampleRate || 16000;
    this.endpointing = options.endpointing !== undefined ? options.endpointing : 200;

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.preConnectBuffer = [];
    this.lastAudioTimestamp = null;
  }

  /**
   * Establish persistent streaming connection to Deepgram
   */
  start() {
    if (this.ws || this.isConnecting) return;

    if (!this.apiKey) {
      this.emit('error', new Error('Deepgram API Key is required'));
      return;
    }

    this.isConnecting = true;

    const queryParams = new URLSearchParams({
      model: this.model,
      language: this.language,
      smart_format: 'true',
      interim_results: 'true',
      endpointing: String(this.endpointing),
      encoding: 'linear16',
      sample_rate: String(this.sampleRate),
      channels: '1'
    });

    const url = `wss://api.deepgram.com/v1/listen?${queryParams.toString()}`;

    try {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Token ${this.apiKey}`
        }
      });

      this.ws.on('open', () => {
        this.isConnected = true;
        this.isConnecting = false;
        this.emit('open');

        // Flush any chunks received during handshake
        while (this.preConnectBuffer.length > 0) {
          const chunk = this.preConnectBuffer.shift();
          this.ws.send(chunk);
        }
      });

      this.ws.on('message', (raw) => {
        try {
          const message = JSON.parse(raw.toString());
          this.handleDeepgramMessage(message);
        } catch (err) {
          console.error('[Deepgram] Error parsing message JSON:', err);
        }
      });

      this.ws.on('error', (err) => {
        this.isConnecting = false;
        console.error('[Deepgram] WebSocket error:', err.message);
        this.emit('error', err);
      });

      this.ws.on('close', (code, reason) => {
        this.isConnected = false;
        this.isConnecting = false;
        this.ws = null;
        this.emit('close', { code, reason: reason?.toString() });
      });
    } catch (err) {
      this.isConnecting = false;
      this.emit('error', err);
    }
  }

  /**
   * Handle incoming Deepgram events
   */
  handleDeepgramMessage(data) {
    if (data.type === 'Metadata') {
      this.emit('metadata', data);
      return;
    }

    // Extract transcript text
    const alternative = data.channel?.alternatives?.[0];
    const transcript = alternative?.transcript || '';
    const confidence = alternative?.confidence || 0;
    const isFinal = Boolean(data.is_final);
    const speechFinal = Boolean(data.speech_final);

    const latencyMs = this.lastAudioTimestamp ? Date.now() - this.lastAudioTimestamp : 0;

    if (transcript.trim().length > 0) {
      if (isFinal) {
        this.emit('final', {
          text: transcript.trim(),
          confidence,
          speechFinal,
          latencyMs
        });
      } else {
        this.emit('interim', {
          text: transcript.trim(),
          confidence,
          latencyMs
        });
      }
    }

    // Deepgram endpointing signal: speaker finished utterance
    if (speechFinal) {
      this.emit('speech_final', {
        text: transcript.trim(),
        latencyMs
      });
    }
  }

  /**
   * Send a binary audio chunk (16kHz linear PCM)
   */
  sendAudio(buffer) {
    this.lastAudioTimestamp = Date.now();

    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
    } else if (this.isConnecting) {
      if (this.preConnectBuffer.length < 30) {
        this.preConnectBuffer.push(buffer);
      }
    }
  }

  /**
   * Gracefully close stream
   */
  stop() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        // Deepgram protocol: send empty binary buffer or CloseStream message to finish
        this.ws.send(JSON.stringify({ type: 'CloseStream' }));
        setTimeout(() => {
          if (this.ws) {
            this.ws.close();
            this.ws = null;
          }
        }, 250);
      } catch {
        if (this.ws) this.ws.close();
      }
    }
    this.isConnected = false;
    this.isConnecting = false;
    this.preConnectBuffer = [];
  }
}
