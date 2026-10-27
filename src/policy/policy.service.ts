import { Injectable } from '@nestjs/common';
import { env } from 'src/config/env';
import { PrismaService } from 'src/prisma/prisma.service';
import { HcaiPolicyAdapter } from './hcai-policy.adapter';
import { LocalPolicyAdapter } from './local-policy.adapter';
import type {
  GoalInput,
  PaidActionInput,
  PolicyResult,
  ResponseInput,
} from './types/policy.type';

const OUTCOME_RANK = { ALLOW: 0, WARN: 1, DENY: 2 } as const;

interface DecisionSubject {
  userId: string | null;
  check: string;
  subjectType: string;
  subjectId?: string | null;
}

/**
 * Runs local rules, then HCAI when enabled, and keeps the stricter outcome.
 * Every non-trivial decision is stored so people can see why the system
 * intervened (the stewardship log).
 */
@Injectable()
export class PolicyService {
  private readonly local = new LocalPolicyAdapter();
  private readonly hcai = env.HCAI_ENABLED ? new HcaiPolicyAdapter() : null;

  constructor(private readonly prisma: PrismaService) {}

  async authorizeAction(
    subject: DecisionSubject,
    input: PaidActionInput,
  ): Promise<PolicyResult> {
    return this.decide(
      subject,
      () => this.local.authorizeAction(input),
      () => this.hcai!.authorizeAction(input),
    );
  }

  async evaluateGoal(
    subject: DecisionSubject,
    input: GoalInput,
  ): Promise<PolicyResult> {
    return this.decide(
      subject,
      () => this.local.evaluateGoal(input),
      () => this.hcai!.evaluateGoal(input),
    );
  }

  async evaluateResponse(
    subject: DecisionSubject,
    input: ResponseInput,
  ): Promise<PolicyResult> {
    return this.decide(
      subject,
      () => this.local.evaluateResponse(input),
      () => this.hcai!.evaluateResponse(input),
    );
  }

  /** Stores an intervention that services decide themselves (e.g. AI content excluded by permission). */
  async note(
    subject: DecisionSubject,
    outcome: 'ALLOW' | 'WARN' | 'DENY',
    plainReason: string,
  ): Promise<void> {
    await this.prisma.policyDecision.create({
      data: {
        userId: subject.userId,
        check: subject.check,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId ?? null,
        outcome,
        source: 'LOCAL',
        plainReason,
      },
    });
  }

  listForUser(userId: string) {
    return this.prisma.policyDecision.findMany({
      where: { userId, userVisible: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        check: true,
        outcome: true,
        source: true,
        plainReason: true,
        subjectType: true,
        subjectId: true,
        createdAt: true,
      },
    });
  }

  private async decide(
    subject: DecisionSubject,
    runLocal: () => Promise<PolicyResult>,
    runHcai: () => Promise<PolicyResult>,
  ): Promise<PolicyResult> {
    const local = await runLocal();
    let result = local;
    if (local.outcome !== 'DENY' && this.hcai) {
      const external = await runHcai();
      if (OUTCOME_RANK[external.outcome] > OUTCOME_RANK[local.outcome]) {
        result = external;
      } else if (external.source === 'HCAI_UNAVAILABLE') {
        result = { ...local, reasons: [...local.reasons, ...external.reasons] };
      }
    }

    if (result.outcome !== 'ALLOW' || result.reasons.length > 0) {
      await this.prisma.policyDecision.create({
        data: {
          userId: subject.userId,
          check: subject.check,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId ?? null,
          outcome: result.outcome,
          source: result.source,
          plainReason: result.reasons.join(' '),
        },
      });
    }
    return result;
  }
}
