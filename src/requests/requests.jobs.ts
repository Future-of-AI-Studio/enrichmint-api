import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { env } from 'src/config/env';
import { OrdersService } from 'src/orders/orders.service';
import { PayoutsService } from 'src/payouts/payouts.service';
import { PrismaService } from 'src/prisma/prisma.service';
import type { RequestEvent } from './request-state';
import { applyTransition } from './utils/apply-transition.util';

const AUTO_CLOSE_AFTER_MS = 7 * 86_400_000;

/**
 * Time-based moves: unanswered requests expire, unpaid acceptances lapse,
 * late deliveries become OVERDUE (which makes a refund automatic). Each move
 * is a conditional update, so a job racing a person's click cannot double-apply.
 */
@Injectable()
export class RequestsJobs {
  private readonly logger = new Logger(RequestsJobs.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly payouts: PayoutsService,
  ) {}

  @Interval(60_000)
  async tick(): Promise<void> {
    if (!env.JOBS_ENABLED || this.running) return;
    this.running = true;
    try {
      await this.runDeadlines();
    } finally {
      this.running = false;
    }
  }

  @Interval(5 * 60_000)
  async reconcile(): Promise<void> {
    if (!env.JOBS_ENABLED || !env.RECONCILE_ENABLED) return;
    await this.orders.reconcile();
    await this.payouts.reconcile();
  }

  /** Public so specs and the demo "fast-forward" can run it on demand. */
  async runDeadlines(now = new Date()): Promise<number> {
    const due = await this.prisma.personalRequest.findMany({
      where: {
        OR: [
          { state: 'SENT', acceptBy: { lt: now } },
          { state: 'ACCEPTED', payBy: { lt: now } },
          { state: 'PAID', deliverBy: { lt: now } },
          {
            state: 'DELIVERED',
            deliveredAt: { lt: new Date(now.getTime() - AUTO_CLOSE_AFTER_MS) },
          },
        ],
      },
      select: { id: true, state: true },
      take: 200,
    });

    let moved = 0;
    for (const request of due) {
      const event: RequestEvent =
        request.state === 'SENT'
          ? 'expire'
          : request.state === 'ACCEPTED'
            ? 'payment_expire'
            : request.state === 'PAID'
              ? 'mark_overdue'
              : 'close';
      try {
        await this.prisma.$transaction(async (tx) => {
          await applyTransition(tx, {
            requestId: request.id,
            event,
            actor: 'SYSTEM',
            reason: 'Deadline passed',
          });
          if (event === 'payment_expire') {
            await tx.order.updateMany({
              where: {
                requestId: request.id,
                status: { in: ['CREATED', 'APPROVED'] },
              },
              data: {
                status: 'VOIDED',
                failureReason: 'payment_window_closed',
              },
            });
          }
        });
        moved += 1;
      } catch (error) {
        // Someone acted on it at the same moment; their move wins.
        this.logger.log(
          `Deadline move ${event} skipped for ${request.id}: ${(error as Error).message}`,
        );
      }
    }
    return moved;
  }
}
