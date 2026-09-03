import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';

const VOICE_SYSTEM_PROMPT = `You are a real-time, helpful AI voice assistant.
Your responses are spoken aloud to the user, so:
1. Keep replies concise, conversational, and direct (1 to 2 short sentences unless the user explicitly requests more detail).
2. Use natural conversational English.
3. NEVER use markdown formatting, bullet points, asterisks, bolding, emojis, or lists that sound awkward when read aloud.
4. When you call a tool (like setting a reminder, getting the weather, or adding a note), summarize the result naturally in a single conversational sentence.`;

/**
 * LLMService
 * Orchestrates streaming LLM responses with real-time tool calling.
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
    console.log(`[LLM Service] Initialized with Tools. Primary Provider: ${this.preferredProvider.toUpperCase()}`);
  }

  /**
   * Stream LLM response with tool execution loop
   */
  async streamResponse(options) {
    const {
      messages,
      systemPrompt = VOICE_SYSTEM_PROMPT,
      onStart = () => {},
      onDelta = () => {},
      onComplete = () => {},
      onError = () => {},
      onToolCall = () => {},
      onToolResult = () => {},
      signal = null
    } = options;

    const startTime = Date.now();
    let ttftMs = null;
    let fullText = '';
    let executedTools = [];

    onStart();

    // 1. Gemini Implementation with Tool Calling
    if (this.geminiClient) {
      try {
        const contents = [];
        for (const msg of messages) {
          contents.push({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
          });
        }

        const toolsConfig = [{
          functionDeclarations: TOOL_DEFINITIONS.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters
          }))
        }];

        // First, check if the LLM desires to invoke a tool
        const checkRes = await this.geminiClient.models.generateContent({
          model: 'gemini-2.5-flash',
          contents,
          config: {
            systemInstruction: systemPrompt,
            tools: toolsConfig,
            temperature: 0.5
          }
        });

        // If tool call is requested, execute tool and feed result back
        if (checkRes.functionCalls && checkRes.functionCalls.length > 0) {
          for (const call of checkRes.functionCalls) {
            console.log(`[LLM Tool Call] ${call.name}:`, JSON.stringify(call.args));
            onToolCall({ name: call.name, args: call.args, timestamp: Date.now() });

            const toolResult = await executeTool(call.name, call.args);
            executedTools.push({ name: call.name, args: call.args, result: toolResult });
            onToolResult({ name: call.name, args: call.args, result: toolResult, timestamp: Date.now() });

            contents.push({
              role: 'model',
              parts: [{ functionCall: call }]
            });
            contents.push({
              role: 'user',
              parts: [{
                functionResponse: {
                  name: call.name,
                  response: toolResult
                }
              }]
            });
          }

          // Stream the final natural language summary of the tool result
          const responseStream = await this.geminiClient.models.generateContentStream({
            model: 'gemini-2.5-flash',
            contents,
            config: {
              systemInstruction: systemPrompt,
              temperature: 0.6,
              maxOutputTokens: 250
            }
          });

          for await (const chunk of responseStream) {
            if (signal && signal.aborted) {
              console.log('[LLM Stream] Generation aborted by user barge-in.');
              break;
            }
            const delta = chunk.text || '';
            if (delta) {
              if (ttftMs === null) {
                ttftMs = Date.now() - startTime;
              }
              fullText += delta;
              onDelta(delta, { ttftMs, elapsedMs: Date.now() - startTime });
            }
          }
        } else {
          // No tool requested: if initial check already produced complete text, stream or emit it
          const initialText = checkRes.text || '';
          if (initialText) {
            ttftMs = Date.now() - startTime;
            fullText = initialText;
            onDelta(initialText, { ttftMs, elapsedMs: ttftMs });
          } else {
            // Stream normally
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
              if (signal && signal.aborted) {
                console.log('[LLM Stream] Generation aborted by user barge-in.');
                break;
              }
              const delta = chunk.text || '';
              if (delta) {
                if (ttftMs === null) {
                  ttftMs = Date.now() - startTime;
                }
                fullText += delta;
                onDelta(delta, { ttftMs, elapsedMs: Date.now() - startTime });
              }
            }
          }
        }

        const totalMs = Date.now() - startTime;
        onComplete({
          fullText: fullText.trim(),
          ttftMs: ttftMs || totalMs,
          totalMs,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          toolsUsed: executedTools,
          interrupted: Boolean(signal?.aborted)
        });
        return;
      } catch (geminiErr) {
        if (signal?.aborted) {
          console.log('[LLM Service] Stream aborted cleanly on barge-in.');
          return;
        }
        console.error('[LLM Service] Gemini error, checking fallback:', geminiErr.message);
        if (!this.anthropicClient) {
          onError(geminiErr);
          return;
        }
      }
    }

    // 2. Anthropic Claude Fallback with Tool Calling
    if (this.anthropicClient) {
      try {
        const claudeTools = TOOL_DEFINITIONS.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters
        }));

        let currentMessages = messages.map(m => ({
          role: m.role,
          content: m.content
        }));

        const initialRes = await this.anthropicClient.messages.create({
          model: 'claude-3-5-haiku-latest',
          system: systemPrompt,
          max_tokens: 250,
          tools: claudeTools,
          messages: currentMessages
        });

        if (initialRes.stop_reason === 'tool_use') {
          const toolUseBlock = initialRes.content.find(b => b.type === 'tool_use');
          if (toolUseBlock) {
            onToolCall({ name: toolUseBlock.name, args: toolUseBlock.input });
            const toolResult = await executeTool(toolUseBlock.name, toolUseBlock.input);
            executedTools.push({ name: toolUseBlock.name, args: toolUseBlock.input, result: toolResult });
            onToolResult({ name: toolUseBlock.name, result: toolResult });

            currentMessages.push({ role: 'assistant', content: initialRes.content });
            currentMessages.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUseBlock.id,
                  content: JSON.stringify(toolResult)
                }
              ]
            });

            const stream = this.anthropicClient.messages.stream({
              model: 'claude-3-5-haiku-latest',
              system: systemPrompt,
              max_tokens: 250,
              messages: currentMessages
            });

            stream.on('text', (delta) => {
              if (ttftMs === null) ttftMs = Date.now() - startTime;
              fullText += delta;
              onDelta(delta, { ttftMs, elapsedMs: Date.now() - startTime });
            });

            await stream.finalMessage();
          }
        } else {
          const textBlock = initialRes.content.find(b => b.type === 'text');
          fullText = textBlock ? textBlock.text : '';
          ttftMs = Date.now() - startTime;
          onDelta(fullText, { ttftMs, elapsedMs: ttftMs });
        }

        const totalMs = Date.now() - startTime;
        onComplete({
          fullText: fullText.trim(),
          ttftMs: ttftMs || totalMs,
          totalMs,
          provider: 'anthropic',
          model: 'claude-3-5-haiku-latest',
          toolsUsed: executedTools
        });
        return;
      } catch (anthropicErr) {
        console.error('[LLM Service] Anthropic error:', anthropicErr.message);
        onError(anthropicErr);
        return;
      }
    }

    onError(new Error('No LLM API keys configured.'));
  }
}
