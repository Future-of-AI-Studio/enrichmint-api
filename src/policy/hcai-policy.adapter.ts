import { Logger } from '@nestjs/common';
import { z } from 'zod';
import { env } from 'src/config/env';
import type {
  GoalInput,
  PaidActionInput,
  PolicyPort,
  PolicyResult,
  ResponseInput,
} from './types/policy.type';

const hcaiResponseSchema = z.object({
  outcome: z.enum(['ALLOW', 'WARN', 'DENY']),
  reasons: z.array(z.string()).default([]),
});

const unavailable = (): PolicyResult => ({
  outcome: 'ALLOW',
  reasons: ['HCAI evaluation unavailable, local rules applied.'],
  source: 'HCAI_UNAVAILABLE',
});

/**
 * Client for the planned HCAI integration API (`/v1/evaluate-request`,
 * `/v1/authorize-action`, `/v1/evaluate-response`). That API is not built yet,
 * so this adapter is off by default and every failure degrades to
 * HCAI_UNAVAILABLE. Only pseudonymous refs and the minimum text are sent.
 */
export class HcaiPolicyAdapter implements PolicyPort {
  private readonly logger = new Logger(HcaiPolicyAdapter.name);

  evaluateGoal(input: GoalInput): Promise<PolicyResult> {
    return this.post('/v1/evaluate-request', {
      subjectRef: input.subjectRef,
      text: input.goalText,
      constraints: { budgetCents: input.budgetCents },
    });
  }

  authorizeAction(input: PaidActionInput): Promise<PolicyResult> {
    return this.post('/v1/authorize-action', {
      subjectRef: input.subjectRef,
      action: input.action,
      amountCents: input.amountCents,
      remainingBudgetCents: input.remainingBudgetCents,
    });
  }

  evaluateResponse(input: ResponseInput): Promise<PolicyResult> {
    return this.post('/v1/evaluate-response', {
      kind: input.kind,
      text: input.text,
    });
  }

  private async post(path: string, body: unknown): Promise<PolicyResult> {
    if (!env.HCAI_BASE_URL || !env.HCAI_API_KEY) return unavailable();
    try {
      const response = await fetch(`${env.HCAI_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.HCAI_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(env.HCAI_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`HCAI ${path} answered ${response.status}.`);
        return unavailable();
      }
      const parsed = hcaiResponseSchema.safeParse(await response.json());
      if (!parsed.success) return unavailable();
      return { ...parsed.data, source: 'HCAI' };
    } catch {
      this.logger.warn(`HCAI ${path} unreachable.`);
      return unavailable();
    }
  }
}
