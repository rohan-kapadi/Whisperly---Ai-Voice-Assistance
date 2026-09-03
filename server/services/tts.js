import { EventEmitter } from 'node:events';

/**
 * SentenceChunker
 * Buffers streaming LLM token deltas and emits complete sentences
 * when punctuation (. ! ? \n) is encountered, enabling low Time-to-First-Audio (TTFA).
 */
export class SentenceChunker extends EventEmitter {
  constructor() {
    super();
    this.buffer = '';
    this.sentenceIndex = 0;
  }

  /**
   * Append new token delta and check for sentence boundaries
   */
  push(delta) {
    if (!delta) return;
    this.buffer += delta;

    // Regex for sentence boundary: ends with punctuation followed by space or newline, or a hard newline
    // Also handles numbers with decimal points (e.g. 24.5 degrees) by requiring punctuation followed by whitespace or end of string
    const match = this.buffer.match(/^(.*?[.!?\n])(\s+.*|$)/s);
    if (match) {
      const sentence = match[1].trim();
      const remainder = match[2] ? match[2].trimStart() : '';

      if (sentence.length > 0) {
        this.sentenceIndex++;
        this.emit('sentence', { text: sentence, index: this.sentenceIndex, isLast: false });
        this.buffer = remainder;
      }
    }
  }

  /**
   * Flush any remaining text in the buffer when LLM generation completes
   */
  flush() {
    const remaining = this.buffer.trim();
    if (remaining.length > 0) {
      this.sentenceIndex++;
      this.emit('sentence', { text: remaining, index: this.sentenceIndex, isLast: true });
    }
    this.buffer = '';
    this.emit('done', { totalSentences: this.sentenceIndex });
  }

  reset() {
    this.buffer = '';
    this.sentenceIndex = 0;
  }
}

/**
 * ElevenLabsTTS
 * High-speed streaming Text-to-Speech using eleven_turbo_v2_5.
 */
export class ElevenLabsTTS {
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.ELEVENLABS_API_KEY;
    this.voiceId = config.voiceId || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
    this.modelId = config.modelId || 'eleven_turbo_v2_5';
  }

  /**
   * Streams audio chunks from ElevenLabs for a given text snippet
   * @param {string} text
   * @param {Object} options
   * @param {Function} options.onAudioChunk - Called with raw audio Buffer or Base64 string
   * @param {Function} [options.onError]
   */
  async streamSpeech(text, options = {}) {
    const { onAudioChunk = () => {}, onError = () => {}, signal } = options;

    if (!text || !text.trim()) return;
    if (signal && signal.aborted) return;

    if (!this.apiKey) {
      onError(new Error('ELEVENLABS_API_KEY is not configured.'));
      return;
    }

    const cleanText = text.replace(/[*_#`]/g, '').trim();
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}/stream?optimize_streaming_latency=4&output_format=mp3_44100_128`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: this.modelId,
          voice_settings: {
            stability: 0.45,
            similarity_boost: 0.82
          }
        })
      });

      if (!response.ok) {
        const errorDetail = await response.text();
        throw new Error(`ElevenLabs HTTP ${response.status}: ${errorDetail}`);
      }

      const chunks = [];
      const reader = response.body.getReader();
      while (true) {
        if (signal && signal.aborted) {
          reader.cancel().catch(() => {});
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (signal && signal.aborted) break;
        if (value && value.length > 0) {
          chunks.push(Buffer.from(value));
        }
      }

      if (chunks.length > 0 && (!signal || !signal.aborted)) {
        const completeSentenceAudio = Buffer.concat(chunks);
        onAudioChunk(completeSentenceAudio);
      }
    } catch (err) {
      if (err.name === 'AbortError' || signal?.aborted) {
        console.log('[TTS Stream] Cancelled by user barge-in.');
        return;
      }
      console.error(`[ElevenLabs TTS Error]`, err.message);
      onError(err);
    }
  }
}
