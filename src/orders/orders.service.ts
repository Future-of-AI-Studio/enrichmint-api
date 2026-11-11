import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Order } from 'generated/prisma/client';
import { env } from 'src/config/env';
import { AuditService } from 'src/audit/audit.service';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { toCents } from 'src/common/utils/money.util';
import { EntitlementsService } from 'src/entitlements/entitlements.service';
import { committedCents, lockGoal } from 'src/goals/utils/budget.util';
import { LedgerService, splitEnrichment } from 'src/ledger/ledger.service';
import { PaypalError, PaypalService } from 'src/paypal/paypal.service';
import type { PaypalCapture } from 'src/paypal/schemas/paypal.schema';
import { PolicyService } from 'src/policy/policy.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { applyTransition } from 'src/requests/utils/apply-transition.util';
import { ZapierService } from 'src/zapier/zapier.service';
import type { CreateOrderDto } from './dto/create-order.dto';

const OPEN_STATUSES = ['CREATED', 'APPROVED'] as const;
const ABANDON_AFTER_MS = 3 * 3_600_000;

const ORDER_SUMMARY_SELECT = {
  id: true,
  kind: true,
  status: true,
  amountCents: true,
  currency: true,
  guideId: true,
  requestId: true,
  goalId: true,
  failureReason: true,
  completedAt: true,
  createdAt: true,
  // The buyer's own PayPal references, shown on their receipt.
  paypalOrderId: true,
  paypalCaptureId: true,
  guide: { select: { id: true, title: true, slug: true } },
} as const;

interface Purchasable {
  kind: 'GUIDE' | 'REQUEST';
  guideId: string | null;
  requestId: string | null;
  goalId: string | null;
  amountCents: number;
  currency: string;
  contributorId: string;
  description: string;
  isOwnOffering: boolean;
}

/**
 * Checkout and fulfilment. Prices always come from the database, access is
 * granted only after PayPal reports a COMPLETED capture whose amount matches,
 * and fulfilment is idempotent so the capture call, the webhook and the
 * reconciler can all race safely.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypal: PaypalService,
    private readonly ledger: LedgerService,
    private readonly entitlements: EntitlementsService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly zapier: ZapierService,
  ) {}

  async create(user: AuthenticatedUser, dto: CreateOrderDto) {
    if (!this.paypal.isConfigured) {
      throw new ServiceUnavailableException({
        error: 'payments_not_configured',
        message: 'Payments are not set up on this server yet.',
      });
    }
    const item = await this.resolvePurchasable(user, dto);

    const remaining = item.goalId
      ? await this.remainingBudget(item.goalId, {
          requestId: item.requestId ?? undefined,
        })
      : null;
    const decision = await this.policy.authorizeAction(
      {
        userId: user.id,
        check: 'checkout',
        subjectType: item.kind.toLowerCase(),
        subjectId: item.guideId ?? item.requestId,
      },
      {
        subjectRef: user.id,
        action: item.kind === 'GUIDE' ? 'purchase_guide' : 'pay_request',
        amountCents: item.amountCents,
        remainingBudgetCents: remaining,
        approvedByUser: dto.approved === true,
        counterpartyAvailable: true,
        isOwnOffering: item.isOwnOffering,
      },
    );
    if (decision.outcome === 'DENY') {
      const overBudget = remaining !== null && item.amountCents > remaining;
      throw new ConflictException({
        error: overBudget ? 'budget_exceeded' : 'policy_denied',
        message: decision.reasons.join(' '),
        remainingBudgetCents: remaining,
      });
    }

    // IMPORTANT: reuse only after the approval and budget checks, so every call is authorized.
    const reusable = await this.prisma.order.findFirst({
      where: {
        buyerId: user.id,
        kind: item.kind,
        guideId: item.guideId,
        requestId: item.requestId,
        goalId: item.goalId,
        status: { in: [...OPEN_STATUSES] },
        paypalOrderId: { not: null },
        createdAt: { gt: new Date(Date.now() - ABANDON_AFTER_MS) },
      },
    });
    if (reusable && reusable.amountCents === item.amountCents) {
      return this.checkoutView(reusable);
    }

    const order = await this.prisma.order.create({
      data: {
        buyerId: user.id,
        goalId: item.goalId,
        kind: item.kind,
        guideId: item.guideId,
        requestId: item.requestId,
        amountCents: item.amountCents,
        currency: item.currency,
        commissionBps: env.COMMISSION_BPS,
        idempotencyKey: randomUUID(),
      },
    });

    try {
      const paypalOrder = await this.paypal.createOrder({
        orderId: order.id,
        amountCents: order.amountCents,
        currency: order.currency,
        description: item.description,
        requestId: order.idempotencyKey,
      });
      const saved = await this.prisma.order.update({
        where: { id: order.id },
        data: { paypalOrderId: paypalOrder.id },
      });
      await this.audit.record({
        actorId: user.id,
        actorType: 'USER',
        action: 'order.created',
        subjectType: 'order',
        subjectId: order.id,
        details: { kind: order.kind, amountCents: order.amountCents },
      });
      return this.checkoutView(saved);
    } catch (error) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: 'FAILED', failureReason: 'paypal_create_failed' },
      });
      this.logger.warn(
        `PayPal order create failed for ${order.id}: ${String(error)}`,
      );
      throw new BadGatewayException({
        error: 'payment_provider_error',
        message: 'PayPal could not start the checkout. Try again in a moment.',
      });
    }
  }

  /** Called after the buyer approves in the PayPal popup. Never trusts the client about the result. */
  async capture(user: AuthenticatedUser, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: user.id },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === 'COMPLETED' || order.status === 'CAPTURE_PENDING') {
      return this.summary(order.id);
    }
    if (
      !OPEN_STATUSES.includes(order.status as (typeof OPEN_STATUSES)[number]) ||
      !order.paypalOrderId
    ) {
      throw new ConflictException({
        error: 'order_not_capturable',
        message: 'This checkout can no longer be completed. Start a new one.',
      });
    }

    await this.claimForCapture(user.id, order);

    let captured: PaypalCapture | undefined;
    try {
      const result = await this.paypal.captureOrder(
        order.paypalOrderId,
        `capture-${order.id}`,
      );
      captured = result.purchase_units[0]?.payments?.captures?.[0];
    } catch (error) {
      if (
        error instanceof PaypalError &&
        error.issue === 'ORDER_ALREADY_CAPTURED'
      ) {
        const existing = await this.paypal.getOrder(order.paypalOrderId);
        captured = existing.purchase_units[0]?.payments?.captures?.[0];
      } else {
        const declined =
          error instanceof PaypalError && error.issue === 'INSTRUMENT_DECLINED';
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            status: declined ? 'DENIED' : 'FAILED',
            failureReason:
              error instanceof PaypalError
                ? (error.issue ?? `http_${error.status}`)
                : 'capture_error',
          },
        });
        if (declined) {
          throw new ConflictException({
            error: 'capture_denied',
            message:
              'PayPal declined this payment method. Nothing was charged; try again with another method.',
          });
        }
        throw new BadGatewayException({
          error: 'payment_provider_error',
          message:
            'PayPal did not confirm the payment. Nothing was granted; check your library in a minute.',
        });
      }
    }

    if (!captured) {
      // No capture object at all: leave it pending and let the webhook or reconciler settle it.
      this.logger.warn(
        `Capture response for ${order.id} had no capture object.`,
      );
      return this.summary(order.id);
    }
    await this.applyCapture(order.id, captured);
    return this.summary(order.id);
  }

  /** Shared by the capture call, the webhook and the reconciler. */
  async applyCapture(orderId: string, capture: PaypalCapture): Promise<void> {
    switch (capture.status) {
      case 'COMPLETED':
        await this.fulfil(orderId, capture);
        return;
      case 'PENDING':
        await this.prisma.order.updateMany({
          where: {
            id: orderId,
            status: { in: ['CREATED', 'APPROVED', 'CAPTURE_PENDING'] },
          },
          data: {
            status: 'CAPTURE_PENDING',
            paypalCaptureId: capture.id,
            failureReason:
              capture.status_details?.reason ?? 'pending_at_paypal',
          },
        });
        return;
      case 'DECLINED':
      case 'FAILED':
        await this.prisma.order.updateMany({
          where: {
            id: orderId,
            status: { in: ['CREATED', 'APPROVED', 'CAPTURE_PENDING'] },
          },
          data: {
            status: 'DENIED',
            failureReason:
              capture.status_details?.reason ?? capture.status.toLowerCase(),
          },
        });
        return;
      default:
        this.logger.log(
          `Capture ${capture.id} for ${orderId} has status ${capture.status}; no action.`,
        );
    }
  }

  async markApproved(paypalOrderId: string): Promise<void> {
    await this.prisma.order.updateMany({
      where: { paypalOrderId, status: 'CREATED' },
      data: { status: 'APPROVED' },
    });
  }

  findMine(userId: string) {
    return this.prisma.order.findMany({
      where: { buyerId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: ORDER_SUMMARY_SELECT,
    });
  }

  async findOneForBuyer(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: userId },
      select: ORDER_SUMMARY_SELECT,
    });
    if (!order) throw new NotFoundException('Order not found.');
    return order;
  }

  /**
   * Settles orders stuck mid-flow: asks PayPal about in-flight captures and
   * voids checkouts nobody finished. Never captures on the buyer's behalf.
   */
  async reconcile(): Promise<{ checked: number }> {
    if (!this.paypal.isConfigured) return { checked: 0 };
    const stale = new Date(Date.now() - 10 * 60_000);
    const pending = await this.prisma.order.findMany({
      where: {
        paypalOrderId: { not: null },
        updatedAt: { lt: stale },
        OR: [
          { status: 'CAPTURE_PENDING' },
          {
            status: { in: [...OPEN_STATUSES] },
            createdAt: { gt: new Date(Date.now() - 3 * 86_400_000) },
          },
        ],
      },
      take: 50,
    });

    for (const order of pending) {
      try {
        const remote = await this.paypal.getOrder(order.paypalOrderId!);
        const capture = remote.purchase_units[0]?.payments?.captures?.[0];
        if (capture) {
          await this.applyCapture(order.id, capture);
        } else if (order.createdAt.getTime() < Date.now() - ABANDON_AFTER_MS) {
          await this.prisma.order.updateMany({
            where: { id: order.id, status: { in: [...OPEN_STATUSES] } },
            data: { status: 'VOIDED', failureReason: 'abandoned_checkout' },
          });
        }
      } catch (error) {
        this.logger.warn(`Reconcile of ${order.id} failed: ${String(error)}`);
      }
    }
    return { checked: pending.length };
  }

  private async fulfil(orderId: string, capture: PaypalCapture): Promise<void> {
    let needsRefundReview: string | null = null;
    // reason: assigned inside the transaction callback, which TS flow analysis does not follow.
    let completed = null as { kind: string; amountCents: number } | null;

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: {
          guide: { select: { contributorId: true, currentVersionId: true } },
          request: { select: { contributorId: true, deliveryH: true } },
        },
      });
      if (['COMPLETED', 'REFUNDED', 'REVERSED'].includes(order.status)) return;

      const capturedCents = toCents(capture.amount.value);
      if (
        capturedCents !== order.amountCents ||
        capture.amount.currency_code !== order.currency
      ) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: 'FAILED',
            paypalCaptureId: capture.id,
            failureReason: 'amount_mismatch_needs_refund',
          },
        });
        await this.audit.record(
          {
            actorType: 'SYSTEM',
            action: 'order.amount_mismatch',
            subjectType: 'order',
            subjectId: order.id,
            details: { capturedCents, expectedCents: order.amountCents },
          },
          tx,
        );
        return;
      }

      const feeCents = capture.seller_receivable_breakdown?.paypal_fee
        ? toCents(capture.seller_receivable_breakdown.paypal_fee.value)
        : 0;
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          status: { in: ['CREATED', 'APPROVED', 'CAPTURE_PENDING'] },
        },
        data: {
          status: 'COMPLETED',
          paypalCaptureId: capture.id,
          paypalFeeCents: feeCents,
          completedAt: new Date(),
          failureReason: null,
        },
      });
      if (claimed.count === 0) return;

      const contributorId =
        order.guide?.contributorId ?? order.request?.contributorId;
      if (!contributorId)
        throw new Error(`Order ${order.id} has no contributor.`);
      // Learners who published a field note on this guide before this order earn a share of it.
      const notes =
        order.kind === 'GUIDE' && order.guideId
          ? await tx.fieldNote.findMany({
              where: {
                guideId: order.guideId,
                status: 'PUBLISHED',
                publishedAt: { lt: order.createdAt },
                payeeContributorId: { not: null },
                authorUserId: { not: order.buyerId },
              },
              orderBy: { publishedAt: 'asc' },
              select: { payeeContributorId: true },
            })
          : [];
      const enrichment = splitEnrichment(
        order.amountCents,
        env.ENRICHMENT_SHARE_BPS,
        notes
          .map((note) => note.payeeContributorId!)
          .filter((id) => id !== contributorId),
      );
      await this.ledger.recordSale(
        tx,
        order,
        contributorId,
        feeCents,
        enrichment,
      );
      completed = { kind: order.kind, amountCents: order.amountCents };

      if (
        order.kind === 'GUIDE' &&
        order.guideId &&
        order.guide?.currentVersionId
      ) {
        await this.entitlements.grant(tx, {
          userId: order.buyerId,
          guideId: order.guideId,
          orderId: order.id,
          versionId: order.guide.currentVersionId,
        });
      }

      if (order.kind === 'REQUEST' && order.requestId && order.request) {
        const paidAt = new Date();
        try {
          await applyTransition(tx, {
            requestId: order.requestId,
            event: 'payment_confirmed',
            actor: 'SYSTEM',
            reason: 'PayPal capture completed',
            data: {
              paidAt,
              // The delivery clock starts when payment is confirmed, not when the request was sent.
              deliverBy: new Date(
                paidAt.getTime() + order.request.deliveryH * 3_600_000,
              ),
            },
          });
        } catch {
          needsRefundReview =
            'The request window closed before the payment completed.';
        }
      }

      await this.audit.record(
        {
          actorType: 'SYSTEM',
          action: 'order.completed',
          subjectType: 'order',
          subjectId: order.id,
          details: { captureId: capture.id, feeCents },
        },
        tx,
      );
    });

    if (completed) {
      this.zapier.notify('order.completed', {
        orderId,
        kind: completed.kind,
        amountCents: completed.amountCents,
        paypalCaptureId: capture.id,
      });
    }

    if (needsRefundReview) {
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
      });
      await this.prisma.refund.create({
        data: {
          orderId,
          amountCents: order.amountCents,
          reason: needsRefundReview,
          requestedBy: order.buyerId,
        },
      });
    }
  }

  /** Re-checks the budget under a row lock and moves the order to CAPTURE_PENDING, reserving the money. */
  private async claimForCapture(userId: string, order: Order): Promise<void> {
    if (order.kind === 'REQUEST' && order.requestId) {
      const request = await this.prisma.personalRequest.findUnique({
        where: { id: order.requestId },
      });
      if (
        !request ||
        request.state !== 'ACCEPTED' ||
        !request.payBy ||
        request.payBy < new Date()
      ) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: 'VOIDED', failureReason: 'request_not_payable' },
        });
        throw new ConflictException({
          error: 'request_not_payable',
          message:
            'This request is no longer waiting for payment. Nothing was charged.',
        });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (order.goalId) {
        const goal = await lockGoal(tx, order.goalId);
        const committed = await committedCents(tx, order.goalId, {
          orderId: order.id,
          requestId: order.requestId ?? undefined,
        });
        if (committed + order.amountCents > goal.budgetCents) {
          await tx.order.update({
            where: { id: order.id },
            data: { status: 'VOIDED', failureReason: 'budget_exceeded' },
          });
          await tx.policyDecision.create({
            data: {
              userId,
              check: 'checkout',
              subjectType: 'order',
              subjectId: order.id,
              outcome: 'DENY',
              source: 'LOCAL',
              plainReason:
                'Payment stopped before charging: it would have taken you over your budget.',
            },
          });
          throw new ConflictException({
            error: 'budget_exceeded',
            message:
              'This payment would take you over your budget, so nothing was charged.',
          });
        }
      }
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: { in: [...OPEN_STATUSES] } },
        data: { status: 'CAPTURE_PENDING' },
      });
      if (claimed.count === 0) {
        throw new ConflictException({
          error: 'order_changed',
          message: 'This checkout just changed. Refresh and try again.',
        });
      }
    });
  }

  private async resolvePurchasable(
    user: AuthenticatedUser,
    dto: CreateOrderDto,
  ): Promise<Purchasable> {
    if (dto.kind === 'GUIDE') {
      if (!dto.guideId) throw new BadRequestException('guideId is required.');
      const guide = await this.prisma.guide.findFirst({
        where: {
          id: dto.guideId,
          status: 'PUBLISHED',
          currentVersionId: { not: null },
        },
        select: {
          id: true,
          title: true,
          priceCents: true,
          currency: true,
          contributorId: true,
        },
      });
      if (!guide) throw new NotFoundException('Guide not found.');
      if (await this.entitlements.findActive(user.id, guide.id)) {
        throw new ConflictException({
          error: 'already_owned',
          message: 'This guide is already in your library.',
        });
      }
      const goalId = dto.goalId
        ? await this.ownGoalId(user.id, dto.goalId)
        : null;
      return {
        kind: 'GUIDE',
        guideId: guide.id,
        requestId: null,
        goalId,
        amountCents: guide.priceCents,
        currency: guide.currency,
        contributorId: guide.contributorId,
        description: `EnrichMINT guide: ${guide.title}`,
        isOwnOffering: guide.contributorId === user.contributorId,
      };
    }

    if (!dto.requestId) throw new BadRequestException('requestId is required.');
    const request = await this.prisma.personalRequest.findFirst({
      where: { id: dto.requestId, learnerId: user.id },
    });
    if (!request) throw new NotFoundException('Request not found.');
    if (
      request.state !== 'ACCEPTED' ||
      !request.payBy ||
      request.payBy < new Date()
    ) {
      throw new ConflictException({
        error: 'request_not_payable',
        message: 'This request is not waiting for payment.',
      });
    }
    return {
      kind: 'REQUEST',
      guideId: null,
      requestId: request.id,
      goalId: request.goalId,
      amountCents: request.priceCents,
      currency: request.currency,
      contributorId: request.contributorId,
      description: 'EnrichMINT personal response',
      isOwnOffering: request.contributorId === user.contributorId,
    };
  }

  private async ownGoalId(userId: string, goalId: string): Promise<string> {
    const goal = await this.prisma.learnerGoal.findFirst({
      where: { id: goalId, userId },
      select: { id: true },
    });
    if (!goal) throw new NotFoundException('Goal not found.');
    return goal.id;
  }

  private async remainingBudget(
    goalId: string,
    exclude: { requestId?: string },
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const goal = await tx.learnerGoal.findUniqueOrThrow({
        where: { id: goalId },
        select: { budgetCents: true },
      });
      return goal.budgetCents - (await committedCents(tx, goalId, exclude));
    });
  }

  private checkoutView(order: Order) {
    return {
      orderId: order.id,
      paypalOrderId: order.paypalOrderId,
      amountCents: order.amountCents,
      currency: order.currency,
      status: order.status,
    };
  }

  private summary(orderId: string) {
    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: ORDER_SUMMARY_SELECT,
    });
  }
}
