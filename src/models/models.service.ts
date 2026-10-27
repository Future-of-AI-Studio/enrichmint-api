import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { env } from 'src/config/env';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  CompletionRequest,
  ModelUnavailableError,
  OpenAiAdapter,
  ToolStepRequest,
  ToolStepResult,
} from './openai.adapter';

export interface ModelCallContext {
  userId?: string | null;
  purpose: string;
  promptVersion: string;
}

/**
 * Every model call goes through here: the daily spend cap is checked first and
 * a ModelCall row (tokens, cost, latency; never content) is written after.
 * Callers treat `null` as "AI unavailable" and fall back to deterministic behaviour.
 */
@Injectable()
export class ModelsService {
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapter: OpenAiAdapter,
  ) {}

  get isConfigured(): boolean {
    return this.adapter.isConfigured;
  }

  async complete<T extends z.ZodType>(
    context: ModelCallContext,
    request: CompletionRequest<T>,
  ): Promise<z.infer<T> | null> {
    if (!this.adapter.isConfigured) return null;
    if (await this.isOverDailyBudget()) {
      this.logger.warn('AI daily budget reached; using fallback behaviour.');
      return null;
    }

    try {
      const result = await this.adapter.complete(request);
      await this.record(context, request.tier, {
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        latencyMs: result.latencyMs,
        ok: true,
      });
      return result.parsed;
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      await this.record(context, request.tier, {
        model: this.adapter.modelFor(request.tier),
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        ok: false,
      });
      return null;
    }
  }

  /** One step of the steward tool loop, under the same budget cap and logging. */
  async toolStep<T extends z.ZodType>(
    context: ModelCallContext,
    request: ToolStepRequest<T>,
  ): Promise<ToolStepResult<z.infer<T>> | null> {
    if (!this.adapter.isConfigured) return null;
    if (await this.isOverDailyBudget()) {
      this.logger.warn('AI daily budget reached; steward step skipped.');
      return null;
    }
    try {
      const result = await this.adapter.runToolStep(request);
      await this.record(context, request.tier, { ...result, ok: true });
      return result;
    } catch (error) {
      if (!(error instanceof ModelUnavailableError)) throw error;
      await this.record(context, request.tier, {
        model: this.adapter.modelFor(request.tier),
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        ok: false,
      });
      return null;
    }
  }

  private async isOverDailyBudget(): Promise<boolean> {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const spent = await this.prisma.modelCall.aggregate({
      _sum: { costUsd: true },
      where: { createdAt: { gte: startOfDay } },
    });
    return Number(spent._sum.costUsd ?? 0) >= env.AI_DAILY_BUDGET_USD;
  }

  private async record(
    context: ModelCallContext,
    tier: 'generate' | 'fast',
    call: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      ok: boolean;
    },
  ): Promise<void> {
    await this.prisma.modelCall.create({
      data: {
        userId: context.userId ?? null,
        purpose: context.purpose,
        promptVersion: context.promptVersion,
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        costUsd: this.adapter.costUsd(
          tier,
          call.inputTokens,
          call.outputTokens,
        ),
        latencyMs: call.latencyMs,
        ok: call.ok,
      },
    });
  }
}
