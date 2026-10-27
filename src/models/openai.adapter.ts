import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import { env } from 'src/config/env';

export type ModelTier = 'generate' | 'fast';

export interface CompletionRequest<T extends z.ZodType> {
  tier: ModelTier;
  system: string;
  input: string;
  schema: T;
  schemaName: string;
  maxOutputTokens?: number;
}

export interface CompletionResult<T> {
  parsed: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export class ModelUnavailableError extends Error {
  constructor(
    readonly reason: 'not_configured' | 'upstream' | 'invalid_output',
  ) {
    super(`Model unavailable: ${reason}`);
  }
}

/** A function tool the steward may call. Parameters are a strict JSON schema. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Conversation items for one tool loop. Model output items are opaque (they
 * may carry encrypted reasoning) and are passed back unchanged.
 */
export type ToolLoopItem =
  | { kind: 'model_output'; raw: unknown }
  | { kind: 'tool_output'; callId: string; output: string };

export interface ToolStepRequest<T extends z.ZodType> {
  tier: ModelTier;
  system: string;
  input: string;
  items: ToolLoopItem[];
  tools: ToolSpec[];
  finalSchema: T;
  finalSchemaName: string;
  maxOutputTokens?: number;
}

export interface ToolCall {
  callId: string;
  name: string;
  arguments: string;
}

export type ToolStepResult<T> = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** Items to append before the next step. */
  newItems: ToolLoopItem[];
} & ({ kind: 'tool_calls'; calls: ToolCall[] } | { kind: 'final'; parsed: T });

/** The part of the SDK this adapter uses, so specs can pass a fake. */
export type OpenAiResponsesClient = Pick<OpenAI, 'responses'>;

/**
 * The only file that imports `openai`. Responses API with `store: false` and a
 * strict json_schema output, so every answer is validated before use. Tools are
 * offered only to the steward, and none of them moves money or sends anything.
 */
export class OpenAiAdapter {
  private readonly logger = new Logger(OpenAiAdapter.name);

  constructor(private readonly client: OpenAiResponsesClient | null) {}

  static fromEnv(): OpenAiAdapter {
    return new OpenAiAdapter(
      env.OPENAI_API_KEY
        ? new OpenAI({
            apiKey: env.OPENAI_API_KEY,
            timeout: env.OPENAI_TIMEOUT_MS,
            maxRetries: env.OPENAI_MAX_RETRIES,
          })
        : null,
    );
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  modelFor(tier: ModelTier): string {
    return tier === 'fast' ? env.OPENAI_MODEL_FAST : env.OPENAI_MODEL_GENERATE;
  }

  costUsd(tier: ModelTier, inputTokens: number, outputTokens: number): number {
    const [inPrice, outPrice] =
      tier === 'fast'
        ? [
            env.OPENAI_PRICE_FAST_INPUT_PER_MTOK,
            env.OPENAI_PRICE_FAST_OUTPUT_PER_MTOK,
          ]
        : [
            env.OPENAI_PRICE_GENERATE_INPUT_PER_MTOK,
            env.OPENAI_PRICE_GENERATE_OUTPUT_PER_MTOK,
          ];
    return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
  }

  async complete<T extends z.ZodType>(
    request: CompletionRequest<T>,
  ): Promise<CompletionResult<z.infer<T>>> {
    if (!this.client) throw new ModelUnavailableError('not_configured');
    const model = this.modelFor(request.tier);
    const started = Date.now();

    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model,
        instructions: request.system,
        input: request.input,
        store: false,
        max_output_tokens: request.maxOutputTokens ?? 4000,
        reasoning: { effort: request.tier === 'fast' ? 'minimal' : 'low' },
        text: { format: zodTextFormat(request.schema, request.schemaName) },
      });
    } catch (error) {
      // Status and type only; upstream text never leaves the server.
      const status = error instanceof OpenAI.APIError ? error.status : 'n/a';
      this.logger.warn(
        `OpenAI request failed (model=${model} status=${status}).`,
      );
      throw new ModelUnavailableError('upstream');
    }

    const latencyMs = Date.now() - started;
    const parsed = request.schema.safeParse(
      safeJsonParse(response.output_text),
    );
    if (response.status !== 'completed' || !parsed.success) {
      this.logger.warn(
        `OpenAI output rejected (schema=${request.schemaName} status=${response.status}).`,
      );
      throw new ModelUnavailableError('invalid_output');
    }
    return {
      parsed: parsed.data,
      model: response.model || model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      latencyMs,
    };
  }

  /**
   * One step of a tool loop: the model either asks for tool calls or returns
   * the final structured message. One tool call at a time keeps steps auditable.
   */
  async runToolStep<T extends z.ZodType>(
    request: ToolStepRequest<T>,
  ): Promise<ToolStepResult<z.infer<T>>> {
    if (!this.client) throw new ModelUnavailableError('not_configured');
    const model = this.modelFor(request.tier);
    const started = Date.now();

    const input: OpenAI.Responses.ResponseInputItem[] = [
      { role: 'user', content: request.input },
      ...request.items.flatMap((item): OpenAI.Responses.ResponseInputItem[] =>
        item.kind === 'model_output'
          ? // reason: model output items are passed back exactly as received.
            [item.raw as OpenAI.Responses.ResponseInputItem]
          : [
              {
                type: 'function_call_output',
                call_id: item.callId,
                output: item.output,
              },
            ],
      ),
    ];

    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model,
        instructions: request.system,
        input,
        store: false,
        include: ['reasoning.encrypted_content'],
        max_output_tokens: request.maxOutputTokens ?? 3000,
        reasoning: { effort: 'low' },
        parallel_tool_calls: false,
        tool_choice: 'auto',
        tools: request.tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: true,
        })),
        text: {
          format: zodTextFormat(request.finalSchema, request.finalSchemaName),
        },
      });
    } catch (error) {
      const status = error instanceof OpenAI.APIError ? error.status : 'n/a';
      this.logger.warn(
        `OpenAI tool step failed (model=${model} status=${status}).`,
      );
      throw new ModelUnavailableError('upstream');
    }

    const usage = {
      model: response.model || model,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
    const newItems: ToolLoopItem[] = response.output.map((raw) => ({
      kind: 'model_output',
      raw,
    }));
    const calls = response.output
      .filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall =>
          item.type === 'function_call',
      )
      .map((item) => ({
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments,
      }));
    if (calls.length > 0) {
      return { ...usage, newItems, kind: 'tool_calls', calls };
    }

    const parsed = request.finalSchema.safeParse(
      safeJsonParse(response.output_text),
    );
    if (response.status !== 'completed' || !parsed.success) {
      this.logger.warn(
        `OpenAI tool step output rejected (schema=${request.finalSchemaName}).`,
      );
      throw new ModelUnavailableError('invalid_output');
    }
    return { ...usage, newItems, kind: 'final', parsed: parsed.data };
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
