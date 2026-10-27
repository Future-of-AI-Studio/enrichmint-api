import type { TransactionClient } from 'src/prisma/prisma.service';

/**
 * Locks the goal row for the rest of the transaction, so two checkouts against
 * the same budget are decided one after the other, never in parallel.
 */
export async function lockGoal(tx: TransactionClient, goalId: string) {
  await tx.$executeRaw`SELECT id FROM learner_goals WHERE id = ${goalId} FOR UPDATE`;
  return tx.learnerGoal.findUniqueOrThrow({
    where: { id: goalId },
    select: { id: true, userId: true, budgetCents: true },
  });
}

/**
 * Money already spent or promised against a goal: completed and in-flight
 * captures, plus requests that were sent or accepted but not paid yet.
 * Refunded orders drop out because their status leaves the set.
 */
export async function committedCents(
  tx: TransactionClient,
  goalId: string,
  exclude: { orderId?: string; requestId?: string } = {},
): Promise<number> {
  const [orders, requests] = await Promise.all([
    tx.order.aggregate({
      _sum: { amountCents: true },
      where: {
        goalId,
        status: { in: ['COMPLETED', 'CAPTURE_PENDING'] },
        ...(exclude.orderId ? { id: { not: exclude.orderId } } : {}),
      },
    }),
    tx.personalRequest.aggregate({
      _sum: { priceCents: true },
      where: {
        goalId,
        state: { in: ['SENT', 'ACCEPTED'] },
        ...(exclude.requestId ? { id: { not: exclude.requestId } } : {}),
      },
    }),
  ]);
  return (orders._sum.amountCents ?? 0) + (requests._sum.priceCents ?? 0);
}
