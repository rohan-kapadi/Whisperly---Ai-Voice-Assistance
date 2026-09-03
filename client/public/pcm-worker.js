// AudioWorkletProcessor for Real-Time PCM 16-bit Audio Extraction
// Collects raw mic audio samples, buffers into ~50ms slices (800 samples at 16kHz),
// computes RMS volume, and converts to 16-bit signed integer linear PCM.

class PCMRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 50ms at 16,000 Hz = 800 samples
    this.bufferSize = 800;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) {
      return true;
    }

    const channelData = input[0]; // Mono input
    const inputLength = channelData.length;

    for (let i = 0; i < inputLength; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      if (this.bufferIndex >= this.bufferSize) {
        this.flushBuffer();
        this.bufferIndex = 0;
      }
    }

    return true;
  }

  flushBuffer() {
    // 1. Calculate RMS volume for visual meter
    let sumSquares = 0;
    for (let i = 0; i < this.bufferSize; i++) {
      sumSquares += this.buffer[i] * this.buffer[i];
    }
    const rms = Math.sqrt(sumSquares / this.bufferSize);

    // 2. Convert Float32 [-1.0, 1.0] to 16-bit signed PCM [-32768, 32767]
    const pcm16 = new Int16Array(this.bufferSize);
    for (let i = 0; i < this.bufferSize; i++) {
      const sample = Math.max(-1, Math.min(1, this.buffer[i]));
      pcm16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    // 3. Post binary chunk buffer and RMS to main thread
    this.port.postMessage(
      {
        type: 'pcm_chunk',
        pcmData: pcm16.buffer,
        rms: rms
      },
      [pcm16.buffer]
    );
  }
}

registerProcessor('pcm-recorder-processor', PCMRecorderProcessor);
