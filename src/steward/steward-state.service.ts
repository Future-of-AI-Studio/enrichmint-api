import { Injectable } from '@nestjs/common';
import type { Prisma, StewardSession } from 'generated/prisma/client';
import { committedCents } from 'src/goals/utils/budget.util';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  deriveStage,
  diffUpdates,
  LastSeen,
  nextStepFor,
  StewardSnapshot,
} from './utils/stage.util';

/**
 * Persistent workflow status. Everything here is read from the database, so
 * changes made by capture, webhooks and deadline jobs show up on the next sync.
 */
@Injectable()
export class StewardStateService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(session: StewardSession): Promise<StewardSnapshot> {
    const [goal, committed, hasAgentTurn, recommendations, gapEvent] =
      await Promise.all([
        this.prisma.learnerGoal.findUniqueOrThrow({
          where: { id: session.goalId },
          select: { id: true, text: true, budgetCents: true },
        }),
        this.prisma.$transaction((tx) => committedCents(tx, session.goalId)),
        this.prisma.stewardEvent.count({
          where: { sessionId: session.id, kind: 'AGENT_MESSAGE' },
        }),
        this.prisma.recommendation.count({ where: { goalId: session.goalId } }),
        this.prisma.stewardEvent.findFirst({
          where: {
            sessionId: session.id,
            kind: 'PROPOSAL',
            tool: 'check_contributor',
          },
          orderBy: { createdAt: 'desc' },
          select: { payload: true },
        }),
      ]);

    let activeGuide: StewardSnapshot['activeGuide'] = null;
    if (session.activeGuideId) {
      const guide = await this.prisma.guide.findUnique({
        where: { id: session.activeGuideId },
        select: {
          id: true,
          slug: true,
          title: true,
          priceCents: true,
          agentAssistAllowed: true,
          contributor: { select: { user: { select: { displayName: true } } } },
          entitlements: {
            where: { userId: session.userId, status: 'ACTIVE' },
            select: { aiQuestionsLimit: true, aiQuestionsUsed: true },
          },
        },
      });
      if (guide) {
        const entitlement = guide.entitlements[0];
        activeGuide = {
          id: guide.id,
          slug: guide.slug,
          title: guide.title,
          priceCents: guide.priceCents,
          owned: Boolean(entitlement),
          agentAssistAllowed: guide.agentAssistAllowed,
          contributorName: guide.contributor.user.displayName,
          questionsLeft: entitlement
            ? entitlement.aiQuestionsLimit - entitlement.aiQuestionsUsed
            : null,
        };
      }
    }

    let activeRequest: StewardSnapshot['activeRequest'] = null;
    if (session.activeRequestId) {
      const request = await this.prisma.personalRequest.findFirst({
        where: { id: session.activeRequestId, learnerId: session.userId },
        select: {
          id: true,
          state: true,
          priceCents: true,
          acceptBy: true,
          payBy: true,
          deliverBy: true,
          contributor: { select: { user: { select: { displayName: true } } } },
          response: { select: { aiUseAllowed: true } },
        },
      });
      if (request) {
        const planCount = await this.prisma.assistantMessage.count({
          where: { requestId: request.id, role: 'assistant' },
        });
        activeRequest = {
          id: request.id,
          state: request.state,
          priceCents: request.priceCents,
          contributorName: request.contributor.user.displayName,
          acceptBy: request.acceptBy?.toISOString() ?? null,
          payBy: request.payBy?.toISOString() ?? null,
          deliverBy: request.deliverBy?.toISOString() ?? null,
          hasResponse: Boolean(request.response),
          responseAiAllowed: request.response?.aiUseAllowed ?? false,
          planCount,
        };
      }
    }

    const gapPayload = gapEvent?.payload as {
      data?: { question?: string };
    } | null;
    return {
      goal: {
        id: goal.id,
        text: goal.text,
        budgetCents: goal.budgetCents,
        committedCents: committed,
        remainingCents: goal.budgetCents - committed,
      },
      hasAgentTurn: hasAgentTurn > 0,
      recommendationsShown: recommendations > 0,
      // An open gap is one the steward found that has no request yet.
      gapQuestion: activeRequest ? null : (gapPayload?.data?.question ?? null),
      activeGuide,
      activeRequest,
    };
  }

  /**
   * Reports backend changes as update events, exactly once each, and stores
   * the derived stage. Makes no AI call.
   */
  async sync(sessionId: string) {
    const session = await this.prisma.stewardSession.findUniqueOrThrow({
      where: { id: sessionId },
    });
    const snapshot = await this.snapshot(session);
    const { updates, lastSeen } = diffUpdates(
      session.lastSeen as LastSeen,
      snapshot,
    );
    const stage = deriveStage(snapshot);

    // Conditional on the lastSeen we read, so two syncs at once cannot both post the same update.
    const claimed = await this.prisma.stewardSession.updateMany({
      where: {
        id: session.id,
        updatedAt: session.updatedAt,
      },
      data: { lastSeen: lastSeen as Prisma.InputJsonValue, stage },
    });
    if (claimed.count > 0 && updates.length > 0) {
      await this.prisma.stewardEvent.createMany({
        data: updates.flatMap((update) => [
          {
            sessionId: session.id,
            kind: 'SYSTEM_UPDATE' as const,
            summary: update.summary,
          },
          ...(update.card
            ? [
                {
                  sessionId: session.id,
                  kind: 'PROPOSAL' as const,
                  summary: update.summary,
                  payload: update.card as unknown as Prisma.InputJsonValue,
                },
              ]
            : []),
        ]),
      });
    }
    return { snapshot, stage, nextStep: nextStepFor(stage, snapshot) };
  }
}
