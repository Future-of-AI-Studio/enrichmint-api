import type { z } from 'zod';
import {
  CompletionRequest,
  CompletionResult,
  ModelUnavailableError,
  ToolStepRequest,
  ToolStepResult,
} from 'src/models/openai.adapter';

type ScriptedStep =
  | { call: string; args: Record<string, unknown> }
  | { final: { say: string; suggestedReplies: string[] } };

/**
 * Stand-in for OpenAiAdapter. Off by default, so other suites behave as if no
 * key is set. Specs queue structured completions and steward tool steps, and
 * can inspect every input the "model" was given.
 */
export class FakeOpenAi {
  isConfigured = false;
  completions: unknown[] = [];
  steps: ScriptedStep[] = [];
  /** Everything sent to the model: prompts and tool outputs. */
  seenInputs: string[] = [];
  private counter = 0;

  reset(): void {
    this.isConfigured = false;
    this.completions = [];
    this.steps = [];
    this.seenInputs = [];
  }

  modelFor(): string {
    return 'fake-model';
  }

  costUsd(): number {
    return 0;
  }

  complete<T extends z.ZodType>(
    request: CompletionRequest<T>,
  ): Promise<CompletionResult<z.infer<T>>> {
    this.seenInputs.push(request.input);
    if (this.completions.length === 0)
      return Promise.reject(new ModelUnavailableError('invalid_output'));
    const parsed = request.schema.parse(this.completions.shift());
    return Promise.resolve({
      parsed,
      model: 'fake-model',
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    });
  }

  runToolStep<T extends z.ZodType>(
    request: ToolStepRequest<T>,
  ): Promise<ToolStepResult<z.infer<T>>> {
    this.seenInputs.push(
      request.input,
      ...request.items.map((item) =>
        item.kind === 'tool_output' ? item.output : '',
      ),
    );
    const step = this.steps.shift();
    const usage = {
      model: 'fake-model',
      inputTokens: 1,
      outputTokens: 1,
      latencyMs: 1,
    };
    if (!step) {
      return Promise.resolve({
        ...usage,
        newItems: [],
        kind: 'final',
        parsed: request.finalSchema.parse({
          say: 'Done.',
          suggestedReplies: [],
        }),
      });
    }
    if ('final' in step) {
      return Promise.resolve({
        ...usage,
        newItems: [],
        kind: 'final',
        parsed: request.finalSchema.parse(step.final),
      });
    }
    const callId = `call_${++this.counter}`;
    return Promise.resolve({
      ...usage,
      newItems: [
        {
          kind: 'model_output',
          raw: { type: 'function_call', call_id: callId, name: step.call },
        },
      ],
      kind: 'tool_calls',
      calls: [
        { callId, name: step.call, arguments: JSON.stringify(step.args) },
      ],
    });
  }
}
