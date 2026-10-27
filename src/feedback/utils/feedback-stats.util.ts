import type { FeedbackTarget } from 'generated/prisma/client';
import type { PrismaService } from 'src/prisma/prisma.service';

/**
 * Separate signals, never one score: immediate relevance and next-step
 * counts, and reported follow-through. None of these is verified.
 */
export interface FeedbackStats {
  responses: number;
  foundRelevant: number;
  foundNextStep: number;
  reportedMissing: number;
  followUps: number;
  triedIt: number;
  usefulAfterTrying: number;
}

export const EMPTY_STATS: FeedbackStats = {
  responses: 0,
  foundRelevant: 0,
  foundNextStep: 0,
  reportedMissing: 0,
  followUps: 0,
  triedIt: 0,
  usefulAfterTrying: 0,
};

export async function feedbackStats(
  prisma: PrismaService,
  targetType: FeedbackTarget,
  targetIds: string[],
): Promise<Map<string, FeedbackStats>> {
  const result = new Map<string, FeedbackStats>();
  if (targetIds.length === 0) return result;
  const rows = await prisma.feedback.findMany({
    where: { targetType, targetId: { in: targetIds } },
    select: {
      targetId: true,
      phase: true,
      relevant: true,
      nextStep: true,
      missingOrMisleading: true,
      tried: true,
      usefulAfter: true,
    },
  });
  for (const row of rows) {
    const stats = result.get(row.targetId) ?? { ...EMPTY_STATS };
    if (row.phase === 'IMMEDIATE') {
      stats.responses += 1;
      if (row.relevant) stats.foundRelevant += 1;
      if (row.nextStep) stats.foundNextStep += 1;
      if (row.missingOrMisleading?.trim()) stats.reportedMissing += 1;
    } else {
      stats.followUps += 1;
      if (row.tried) stats.triedIt += 1;
      if (row.tried && row.usefulAfter) stats.usefulAfterTrying += 1;
    }
    result.set(row.targetId, stats);
  }
  return result;
}
