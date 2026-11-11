import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { scrubPii } from 'src/common/utils/pii.util';
import { wrapUntrusted } from 'src/common/utils/prompt.util';
import { EntitlementsService } from 'src/entitlements/entitlements.service';
import { committedCents } from 'src/goals/utils/budget.util';
import { ModelsService } from 'src/models/models.service';
import { PolicyService } from 'src/policy/policy.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ANSWER_SYSTEM, PROMPT_VERSION } from './constants/assistant.constants';
import { GroundingService } from './grounding.service';
import { answerSchema } from './schemas/answer.schema';
import { buildAnswerInput } from './utils/answer-input.util';
import {
  AnswerBlock,
  SourceText,
  verifyAttribution,
} from './utils/attribution.util';

const MAX_PLANS_PER_REQUEST = 3;

@Injectable()
export class AssistantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelsService,
    private readonly grounding: GroundingService,
    private readonly entitlements: EntitlementsService,
    private readonly policy: PolicyService,
  ) {}

  async ask(
    userId: string,
    guideId: string,
    question: string,
    goalId?: string,
  ) {
    // Access and permission are checked before anything else, so errors never hint at content.
    const context = await this.grounding.loadGuideContext(userId, guideId);
    if (!this.models.isConfigured) {
      throw new ServiceUnavailableException({
        error: 'ai_not_configured',
        message:
          'AI assistance is not available on this server right now. Your guide is still readable.',
      });
    }
    const goal = goalId
      ? await this.prisma.learnerGoal.findFirst({
          where: { id: goalId, userId },
        })
      : null;
    await this.entitlements.consumeQuestion(context.entitlementId);

    const history = await this.prisma.assistantMessage.findMany({
      where: { userId, guideId, requestId: null },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });
    const historyText = history
      .reverse()
      .map((message) =>
        message.role === 'user'
          ? `Learner: ${(message.content as { text?: string }).text ?? ''}`
          : `Assistant: ${((message.content as { blocks?: AnswerBlock[] }).blocks ?? []).map((block) => block.text).join(' ')}`,
      )
      .join('\n');

    const input = buildAnswerInput({
      guideTitle: context.guide.title,
      contributorName: context.guide.contributorName,
      sourcesPrompt: context.promptText,
      situation: goal?.text,
      history: historyText,
      question,
    });

    const output = await this.models.complete(
      {
        userId,
        purpose: 'grounded_answer',
        promptVersion: PROMPT_VERSION.answer,
      },
      {
        tier: 'generate',
        system: ANSWER_SYSTEM,
        input,
        schema: answerSchema,
        schemaName: 'grounded_answer',
        maxOutputTokens: 3000,
      },
    );
    if (!output) {
      // The question was not answered, so it is not charged against the allowance.
      await this.prisma.entitlement.update({
        where: { id: context.entitlementId },
        data: { aiQuestionsUsed: { decrement: 1 } },
      });
      throw new ServiceUnavailableException({
        error: 'ai_unavailable',
        message: await this.models.unavailableMessage(
          'The assistant could not answer just now. This question was not counted. Try again shortly.',
        ),
      });
    }

    const blocks = verifyAttribution(output.blocks, context.sources);
    const gap =
      output.gap.detected && output.gap.question
        ? { question: output.gap.question, reason: output.gap.reason }
        : null;
    const requestOffer = gap
      ? await this.requestOffer(
          userId,
          context.guide.contributorId,
          goal?.id ?? null,
        )
      : null;
    if (gap) {
      await this.prisma.guideGap.create({
        data: { guideId, userId, question: gap.question },
      });
    }
    const review = await this.policy.evaluateResponse(
      {
        userId,
        check: 'assistant_answer',
        subjectType: 'guide',
        subjectId: guideId,
      },
      {
        kind: 'assistant_answer',
        text: blocks.map((block) => block.text).join('\n'),
      },
    );

    const flags = [
      ...(blocks.some((block) => block.unverified)
        ? ['attribution_downgraded']
        : []),
      ...(review.outcome === 'WARN' ? ['policy_warning'] : []),
    ];
    await this.prisma.assistantMessage.create({
      data: { userId, guideId, role: 'user', content: { text: question } },
    });
    const saved = await this.prisma.assistantMessage.create({
      data: {
        userId,
        guideId,
        role: 'assistant',
        content: {
          blocks,
          gap,
          requestOffer,
          warnings: review.outcome === 'WARN' ? review.reasons : [],
        } as unknown as Prisma.InputJsonValue,
        flags,
      },
    });
    const entitlement = await this.prisma.entitlement.findUniqueOrThrow({
      where: { id: context.entitlementId },
    });
    return {
      message: {
        id: saved.id,
        role: 'assistant',
        content: saved.content,
        flags,
        createdAt: saved.createdAt,
      },
      quota: {
        limit: entitlement.aiQuestionsLimit,
        used: entitlement.aiQuestionsUsed,
      },
      sources: context.sources.map((source) => ({
        id: source.id,
        title: source.title,
      })),
      contributorName: context.guide.contributorName,
    };
  }

  async history(userId: string, guideId: string) {
    await this.entitlements.requireActive(userId, guideId);
    const [messages, guide] = await Promise.all([
      this.prisma.assistantMessage.findMany({
        where: { userId, guideId, requestId: null },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: {
          id: true,
          role: true,
          content: true,
          flags: true,
          createdAt: true,
        },
      }),
      this.prisma.guide.findUniqueOrThrow({
        where: { id: guideId },
        select: { agentAssistAllowed: true },
      }),
    ]);
    // Answers given before the contributor withdrew AI permission stay visible, clearly marked.
    return messages.map((message) =>
      !guide.agentAssistAllowed && message.role === 'assistant'
        ? {
            ...message,
            flags: [...message.flags, 'source_permission_withdrawn'],
          }
        : message,
    );
  }

  /**
   * Helps the learner apply a delivered personal response, plus the guide when
   * it may be used. Only with the contributor's permission for that response.
   */
  async applyResponse(userId: string, requestId: string) {
    if (!this.models.isConfigured) {
      throw new ServiceUnavailableException({
        error: 'ai_not_configured',
        message: 'AI assistance is not available right now.',
      });
    }
    const request = await this.prisma.personalRequest.findFirst({
      where: { id: requestId, learnerId: userId },
      include: {
        response: true,
        goal: true,
        contributor: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (!request) throw new NotFoundException('Request not found.');
    if (!request.response) {
      throw new ForbiddenException({
        error: 'not_delivered',
        message: 'The response has not been delivered yet.',
      });
    }
    const name = request.contributor.user.displayName;
    if (!request.response.aiUseAllowed) {
      await this.policy.note(
        {
          userId,
          check: 'agent_access',
          subjectType: 'request',
          subjectId: requestId,
        },
        'DENY',
        `${name} asked that AI not use this personal response, so the assistant did not read it.`,
      );
      throw new ForbiddenException({
        error: 'response_ai_not_permitted',
        message: `${name} asked that AI not use this response. You can still read it.`,
      });
    }
    const used = await this.prisma.assistantMessage.count({
      where: { userId, requestId, role: 'assistant' },
    });
    if (used >= MAX_PLANS_PER_REQUEST) {
      throw new HttpException(
        {
          error: 'quota_exhausted',
          message: 'You have used the AI help included with this response.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const sources: SourceText[] = [
      {
        id: 'response',
        title: `${name}'s personal response`,
        body: request.response.body,
      },
    ];
    let guidePrompt = '';
    if (request.guideId) {
      try {
        const context = await this.grounding.loadGuideContext(
          userId,
          request.guideId,
        );
        sources.push(...context.sources);
        guidePrompt = context.promptText;
      } catch {
        // Not bought, or AI not permitted for the guide: the plan uses the response alone.
      }
    }

    const input = [
      wrapUntrusted(
        'contributor_source',
        `${sources[0].title}\n${request.response.body}`,
        { id: 'response' },
      ),
      guidePrompt,
      request.goal
        ? wrapUntrusted('learner_situation', scrubPii(request.goal.text))
        : '',
      wrapUntrusted(
        'learner_question',
        scrubPii(
          `My question was: ${request.question}\nHelp me turn this into concrete next steps for my situation.`,
        ),
      ),
      // Outside the untrusted tags on purpose: this is our formatting rule, so the UI can show a checklist.
      'Format: write the steps inside AI_SUGGESTION blocks, one step per line, each line starting with "- ".',
    ]
      .filter(Boolean)
      .join('\n\n');

    const output = await this.models.complete(
      {
        userId,
        purpose: 'apply_response',
        promptVersion: PROMPT_VERSION.apply,
      },
      {
        tier: 'generate',
        system: ANSWER_SYSTEM,
        input,
        schema: answerSchema,
        schemaName: 'apply_response',
        maxOutputTokens: 3000,
      },
    );
    if (!output) {
      throw new ServiceUnavailableException({
        error: 'ai_unavailable',
        message: await this.models.unavailableMessage(
          'The assistant could not help just now. Try again shortly.',
        ),
      });
    }
    const blocks = verifyAttribution(output.blocks, sources);
    const saved = await this.prisma.assistantMessage.create({
      data: {
        userId,
        guideId: request.guideId,
        requestId,
        role: 'assistant',
        content: {
          blocks,
          gap: null,
          requestOffer: null,
        } as unknown as Prisma.InputJsonValue,
        flags: blocks.some((block) => block.unverified)
          ? ['attribution_downgraded']
          : [],
      },
    });
    return {
      message: {
        id: saved.id,
        role: 'assistant',
        content: saved.content,
        flags: saved.flags,
        createdAt: saved.createdAt,
      },
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
      })),
      contributorName: name,
      remaining: MAX_PLANS_PER_REQUEST - used - 1,
    };
  }

  planHistory(userId: string, requestId: string) {
    return this.prisma.assistantMessage.findMany({
      where: { userId, requestId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        flags: true,
        createdAt: true,
      },
    });
  }

  /** What the learner could ask the contributor for, with the budget check shown up front. */
  async requestOffer(
    userId: string,
    contributorId: string,
    goalId: string | null,
  ) {
    const contributor = await this.prisma.contributorProfile.findUniqueOrThrow({
      where: { id: contributorId },
      select: {
        id: true,
        status: true,
        acceptingRequests: true,
        responsePriceCents: true,
        deliveryH: true,
        acceptanceWindowH: true,
        userId: true,
        user: { select: { displayName: true } },
      },
    });
    const available =
      contributor.status === 'APPROVED' &&
      contributor.acceptingRequests &&
      Boolean(contributor.responsePriceCents) &&
      contributor.userId !== userId;
    if (!available) {
      return {
        available: false as const,
        contributorName: contributor.user.displayName,
      };
    }
    let remainingBudgetCents: number | null = null;
    if (goalId) {
      const goal = await this.prisma.learnerGoal.findUniqueOrThrow({
        where: { id: goalId },
      });
      remainingBudgetCents =
        goal.budgetCents -
        (await this.prisma.$transaction((tx) => committedCents(tx, goalId)));
    }
    return {
      available: true as const,
      contributorId: contributor.id,
      contributorName: contributor.user.displayName,
      priceCents: contributor.responsePriceCents!,
      deliveryH: contributor.deliveryH,
      acceptanceH: contributor.acceptanceWindowH,
      remainingBudgetCents,
      withinBudget:
        remainingBudgetCents === null ||
        contributor.responsePriceCents! <= remainingBudgetCents,
    };
  }
}
