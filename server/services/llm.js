import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';

const VOICE_SYSTEM_PROMPT = `You are a real-time, helpful AI voice assistant.
Your responses are spoken aloud to the user, so:
1. Keep replies concise, conversational, and direct (1 to 2 short sentences unless the user explicitly requests more detail).
2. Use natural conversational English.
3. NEVER use markdown formatting, bullet points, asterisks, bolding, emojis, or lists that sound awkward when read aloud.
4. Speak warmly and naturally.`;

/**
 * LLMService
 * Orchestrates streaming LLM responses with low Time-to-First-Token (TTFT).
 * Supports Gemini (default) and Anthropic Claude.
 */
export class LLMService {
  constructor(config = {}) {
    this.geminiKey = config.geminiKey || process.env.GEMINI_API_KEY;
    this.anthropicKey = config.anthropicKey || process.env.ANTHROPIC_API_KEY;

    this.geminiClient = null;
    this.anthropicClient = null;

    if (this.geminiKey) {
      this.geminiClient = new GoogleGenAI({ apiKey: this.geminiKey });
    }
    if (this.anthropicKey) {
      this.anthropicClient = new Anthropic({ apiKey: this.anthropicKey });
    }

    this.preferredProvider = this.geminiClient ? 'gemini' : (this.anthropicClient ? 'anthropic' : 'none');
    console.log(`[LLM Service] Initialized. Primary Provider: ${this.preferredProvider.toUpperCase()}`);
  }

  /**
   * Stream LLM response
   * @param {Object} options
   * @param {Array<{role: string, content: string}>} options.messages - conversation history
   * @param {string} [options.systemPrompt]
   * @param {Function} options.onStart
   * @param {Function} options.onDelta
   * @param {Function} options.onComplete
   * @param {Function} options.onError
   */
  async streamResponse(options) {
    const {
      messages,
      systemPrompt = VOICE_SYSTEM_PROMPT,
      onStart = () => {},
      onDelta = () => {},
      onComplete = () => {},
      onError = () => {}
    } = options;

    const startTime = Date.now();
    let ttftMs = null;
    let fullText = '';

    onStart();

    // Use Gemini if available
    if (this.geminiClient) {
      try {
        // Format history for Gemini contents
        const contents = [];

        // Insert system instruction through prompt or configuration
        for (const msg of messages) {
          contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          });
        }

        const responseStream = await this.geminiClient.models.generateContentStream({
          model: 'gemini-2.5-flash',
          contents,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
            maxOutputTokens: 250
          }
        });

        for await (const chunk of responseStream) {
          const delta = chunk.text || '';
          if (delta) {
            if (ttftMs === null) {
              ttftMs = Date.now() - startTime;
            }
            fullText += delta;
            onDelta(delta, { ttftMs, elapsedMs: Date.now() - startTime });
          }
        }

        const totalMs = Date.now() - startTime;
        onComplete({
          fullText: fullText.trim(),
          ttftMs: ttftMs || totalMs,
          totalMs,
          provider: 'gemini',
          model: 'gemini-2.5-flash'
        });
        return;
      } catch (geminiErr) {
        console.error('[LLM Service] Gemini error, checking fallback:', geminiErr.message);
        if (!this.anthropicClient) {
          onError(geminiErr);
          return;
        }
      }
    }

    // Fallback or Primary Anthropic Claude
    if (this.anthropicClient) {
      try {
        const stream = this.anthropicClient.messages.stream({
          model: 'claude-3-5-haiku-latest',
          system: systemPrompt,
          max_tokens: 250,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content
          }))
        });

        stream.on('text', (delta) => {
          if (ttftMs === null) {
            ttftMs = Date.now() - startTime;
          }
          fullText += delta;
          onDelta(delta, { ttftMs, elapsedMs: Date.now() - startTime });
        });

        const finalMessage = await stream.finalMessage();
        const totalMs = Date.now() - startTime;

        onComplete({
          fullText: fullText.trim(),
          ttftMs: ttftMs || totalMs,
          totalMs,
          provider: 'anthropic',
          model: 'claude-3-5-haiku-latest'
        });
        return;
      } catch (anthropicErr) {
        console.error('[LLM Service] Anthropic error:', anthropicErr.message);
        onError(anthropicErr);
        return;
      }
    }

    onError(new Error('No LLM API keys configured (GEMINI_API_KEY or ANTHROPIC_API_KEY required).'));
  }
}
