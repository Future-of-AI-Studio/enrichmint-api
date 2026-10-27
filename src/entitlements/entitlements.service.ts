import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { env } from 'src/config/env';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';

/**
 * The single source of truth for "may this person see this guide". Every
 * protected content and retrieval path calls `requireActive`.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(
    tx: TransactionClient,
    input: {
      userId: string;
      guideId: string;
      orderId: string;
      versionId: string;
    },
  ): Promise<void> {
    const aiExpiresAt = new Date(Date.now() + env.AI_ACCESS_DAYS * 86_400_000);
    // A refunded buyer who buys again gets a fresh entitlement on the same row.
    await tx.entitlement.upsert({
      where: {
        userId_guideId: { userId: input.userId, guideId: input.guideId },
      },
      create: {
        userId: input.userId,
        guideId: input.guideId,
        orderId: input.orderId,
        purchasedVersionId: input.versionId,
        aiQuestionsLimit: env.AI_QUESTIONS_PER_PURCHASE,
        aiExpiresAt,
      },
      update: {
        orderId: input.orderId,
        purchasedVersionId: input.versionId,
        aiQuestionsLimit: env.AI_QUESTIONS_PER_PURCHASE,
        aiQuestionsUsed: 0,
        aiExpiresAt,
        status: 'ACTIVE',
      },
    });
  }

  async revokeForOrder(
    tx: TransactionClient,
    orderId: string,
    status: 'REVOKED_REFUND' | 'REVOKED_ADMIN',
  ): Promise<void> {
    await tx.entitlement.updateMany({
      where: { orderId, status: 'ACTIVE' },
      data: { status },
    });
  }

  findActive(userId: string, guideId: string) {
    return this.prisma.entitlement.findFirst({
      where: { userId, guideId, status: 'ACTIVE' },
    });
  }

  async requireActive(userId: string, guideId: string) {
    const entitlement = await this.findActive(userId, guideId);
    if (!entitlement) {
      throw new ForbiddenException({
        error: 'not_entitled',
        message: 'Buy this guide to read it.',
      });
    }
    return entitlement;
  }

  /** Uses one AI question atomically, so two parallel requests cannot both take the last one. */
  async consumeQuestion(entitlementId: string): Promise<void> {
    const rows = await this.prisma.$executeRaw`
      UPDATE entitlements
         SET ai_questions_used = ai_questions_used + 1, updated_at = now()
       WHERE id = ${entitlementId}
         AND status = 'ACTIVE'
         AND ai_questions_used < ai_questions_limit
         AND ai_expires_at > now()`;
    if (rows === 0) {
      throw new HttpException(
        {
          error: 'quota_exhausted',
          message:
            'You have used the AI questions included with this guide. You can still read it any time.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
