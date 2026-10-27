import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Prisma } from 'generated/prisma/client';
import { env } from 'src/config/env';
import { AuditService } from 'src/audit/audit.service';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { wrapUntrusted } from 'src/common/utils/prompt.util';
import { ModelsService } from 'src/models/models.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  DRAFT_SYSTEM,
  FOLLOW_UP_SYSTEM,
  INTERVIEW_QUESTIONS,
  InterviewAnswer,
  MAX_FOLLOW_UPS,
  PROMPT_VERSION,
} from './constants/interview.constants';
import type { AnswerDto, DraftGuideDto } from './dto/interview.dto';
import { draftSchema, followUpSchema } from './schemas/interview-ai.schema';
import {
  buildDraftInput,
  normalizeDraft,
  verbatimDraft,
} from './utils/draft.util';

@Injectable()
export class InterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly models: ModelsService,
    private readonly audit: AuditService,
  ) {}

  questions() {
    return INTERVIEW_QUESTIONS;
  }

  async start(contributorId: string) {
    const interview = await this.prisma.interview.create({
      data: { contributorId },
    });
    return this.view(interview.id, contributorId);
  }

  async mine(contributorId: string) {
    return this.prisma.interview.findMany({
      where: { contributorId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, status: true, guideId: true, updatedAt: true },
    });
  }

  async view(interviewId: string, contributorId: string) {
    const interview = await this.prisma.interview.findFirst({
      where: { id: interviewId, contributorId },
    });
    if (!interview) throw new NotFoundException('Interview not found.');
    const answers = interview.answers as unknown as InterviewAnswer[];
    const next = INTERVIEW_QUESTIONS.find(
      (question) => !answers.some((answer) => answer.key === question.key),
    );
    const pendingFollowUp = answers.find(
      (answer) => answer.followUp && answer.followUp.answer === null,
    );
    return {
      id: interview.id,
      status: interview.status,
      guideId: interview.guideId,
      questions: INTERVIEW_QUESTIONS,
      answers,
      pendingFollowUp: pendingFollowUp
        ? {
            key: pendingFollowUp.key,
            question: pendingFollowUp.followUp!.question,
          }
        : null,
      nextQuestion: next ?? null,
      aiAvailable: this.models.isConfigured,
    };
  }

  async answer(user: AuthenticatedUser, interviewId: string, dto: AnswerDto) {
    const contributorId = user.contributorId!;
    const interview = await this.prisma.interview.findFirst({
      where: { id: interviewId, contributorId },
    });
    if (!interview) throw new NotFoundException('Interview not found.');
    if (interview.status === 'DRAFTED') {
      throw new ConflictException({
        error: 'interview_drafted',
        message:
          'This interview already became a guide. Edit the guide instead.',
      });
    }
    const question = INTERVIEW_QUESTIONS.find((item) => item.key === dto.key);
    if (!question) throw new BadRequestException('Unknown interview question.');

    const answers = [...(interview.answers as unknown as InterviewAnswer[])];
    const existing = answers.find((answer) => answer.key === dto.key);

    if (dto.isFollowUp) {
      if (!existing?.followUp)
        throw new BadRequestException(
          'There is no follow-up for this question.',
        );
      existing.followUp.answer = dto.answer.trim();
    } else {
      const followUpsAsked = answers.filter(
        (answer) => answer.followUp && answer.key !== dto.key,
      ).length;
      const followUp =
        followUpsAsked < MAX_FOLLOW_UPS
          ? await this.followUpFor(user.id, question.question, dto.answer)
          : null;
      const entry: InterviewAnswer = {
        key: dto.key,
        question: question.question,
        answer: dto.answer.trim(),
        ...(followUp ? { followUp: { question: followUp, answer: null } } : {}),
      };
      if (existing) answers.splice(answers.indexOf(existing), 1, entry);
      else answers.push(entry);
    }

    const complete = INTERVIEW_QUESTIONS.every((item) =>
      answers.some((answer) => answer.key === item.key),
    );
    await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        answers: answers as unknown as Prisma.InputJsonValue,
        status: complete ? 'COMPLETED' : 'IN_PROGRESS',
      },
    });
    return this.view(interviewId, contributorId);
  }

  /** Turns the answers into a DRAFT guide the contributor edits and approves. Nothing is published here. */
  async draft(
    user: AuthenticatedUser,
    interviewId: string,
    dto: DraftGuideDto,
  ) {
    const contributorId = user.contributorId!;
    const interview = await this.prisma.interview.findFirst({
      where: { id: interviewId, contributorId },
      include: { contributor: { select: { background: true } } },
    });
    if (!interview) throw new NotFoundException('Interview not found.');
    if (interview.guideId) {
      throw new ConflictException({
        error: 'interview_drafted',
        message: 'This interview already has a guide.',
      });
    }
    const answers = interview.answers as unknown as InterviewAnswer[];
    if (answers.length < 3) {
      throw new BadRequestException({
        error: 'interview_incomplete',
        message: 'Answer at least three questions before drafting a guide.',
      });
    }
    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, isActive: true },
    });
    if (!category) throw new BadRequestException('Unknown category.');

    const background = interview.contributor.background;
    const input = buildDraftInput(background, answers);

    const output = await this.models.complete(
      {
        userId: user.id,
        purpose: 'guide_draft',
        promptVersion: PROMPT_VERSION.draft,
      },
      {
        tier: 'generate',
        system: DRAFT_SYSTEM,
        input,
        schema: draftSchema,
        schemaName: 'guide_draft',
        maxOutputTokens: 6000,
      },
    );
    const draft = output
      ? normalizeDraft(output, answers, background)
      : verbatimDraft(answers, background);

    const guide = await this.prisma.$transaction(async (tx) => {
      const created = await tx.guide.create({
        data: {
          contributorId,
          categoryId: category.id,
          slug: `${slugify(draft.title)}-${randomBytes(3).toString('hex')}`,
          title: draft.title,
          priceCents: dto.priceCents ?? env.MIN_PRICE_CENTS,
          topics: draft.topics,
        },
      });
      await tx.guideVersion.create({
        data: {
          guideId: created.id,
          number: 1,
          summary: draft.summary,
          preview: draft.preview,
          audience:
            draft.sections.find((section) => section.key === 'audience')
              ?.body ?? '',
          limitations:
            draft.sections.find((section) => section.key === 'limitations')
              ?.body ?? '',
          sections: draft.sections as unknown as Prisma.InputJsonValue,
          gaps: draft.gaps as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.interview.update({
        where: { id: interviewId },
        data: { guideId: created.id, status: 'DRAFTED' },
      });
      return created;
    });

    await this.audit.record({
      actorId: user.id,
      actorType: output ? 'AGENT' : 'SYSTEM',
      action: 'guide.drafted',
      subjectType: 'guide',
      subjectId: guide.id,
      details: { aiUsed: Boolean(output), gaps: draft.gaps.length },
    });
    return { guideId: guide.id, aiUsed: Boolean(output), gaps: draft.gaps };
  }

  private async followUpFor(
    userId: string,
    question: string,
    answer: string,
  ): Promise<string | null> {
    if (answer.trim().length > 600) return null;
    const output = await this.models.complete(
      {
        userId,
        purpose: 'interview_followup',
        promptVersion: PROMPT_VERSION.followUp,
      },
      {
        tier: 'fast',
        system: FOLLOW_UP_SYSTEM,
        input: `Interview question: ${question}\n\n${wrapUntrusted('contributor_answer', answer)}`,
        schema: followUpSchema,
        schemaName: 'follow_up',
        maxOutputTokens: 400,
      },
    );
    return output?.followUp?.trim() || null;
  }
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'guide'
  );
}
