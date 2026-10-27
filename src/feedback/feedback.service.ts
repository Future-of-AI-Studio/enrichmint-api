import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { FeedbackDto } from './dto/feedback.dto';
import { feedbackStats } from './utils/feedback-stats.util';

/**
 * Usefulness feedback from people who actually received the guidance. It
 * informs matching and is shown as separate counts; it never affects whether
 * a contributor is paid for agreed work.
 */
@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async submit(userId: string, dto: FeedbackDto) {
    await this.assertEligible(userId, dto.targetType, dto.targetId);
    const immediate = dto.phase === 'IMMEDIATE';
    const fields = immediate
      ? {
          relevant: dto.relevant ?? null,
          nextStep: dto.nextStep ?? null,
          missingOrMisleading: dto.missingOrMisleading?.trim() || null,
        }
      : {
          tried: dto.tried ?? null,
          outcome: dto.outcome?.trim() || null,
          usefulAfter: dto.usefulAfter ?? null,
        };
    return this.prisma.feedback.upsert({
      where: {
        userId_targetType_targetId_phase: {
          userId,
          targetType: dto.targetType,
          targetId: dto.targetId,
          phase: dto.phase,
        },
      },
      create: {
        userId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        phase: dto.phase,
        ...fields,
      },
      update: fields,
    });
  }

  mine(userId: string, targetType: 'GUIDE' | 'RESPONSE', targetId: string) {
    return this.prisma.feedback.findMany({
      where: { userId, targetType, targetId },
    });
  }

  async stats(targetType: 'GUIDE' | 'RESPONSE', targetId: string) {
    const map = await feedbackStats(this.prisma, targetType, [targetId]);
    return map.get(targetId) ?? null;
  }

  private async assertEligible(
    userId: string,
    targetType: 'GUIDE' | 'RESPONSE',
    targetId: string,
  ) {
    const eligible =
      targetType === 'GUIDE'
        ? await this.prisma.entitlement.count({
            where: { userId, guideId: targetId },
          })
        : await this.prisma.personalRequest.count({
            where: {
              id: targetId,
              learnerId: userId,
              response: { isNot: null },
            },
          });
    if (!eligible) {
      throw new ForbiddenException({
        error: 'feedback_not_allowed',
        message:
          'Only people who received this guidance can give feedback on it.',
      });
    }
  }
}
