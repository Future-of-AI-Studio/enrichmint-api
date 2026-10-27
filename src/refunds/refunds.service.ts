import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from 'src/audit/audit.service';
import { EntitlementsService } from 'src/entitlements/entitlements.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { PaypalError, PaypalService } from 'src/paypal/paypal.service';
import type { PaypalRefund } from 'src/paypal/schemas/paypal.schema';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';
import { applyTransition } from 'src/requests/utils/apply-transition.util';

const OPEN_REFUND = ['REQUESTED', 'APPROVED', 'SUBMITTED'] as const;

/**
 * Full refunds only (MVP). The buyer asks, an admin decides, PayPal executes;
 * a missed delivery is approved automatically. Effects (ledger reversal,
 * access revoked, request state) are applied once, whichever of the API
 * response or the webhook arrives first.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypal: PaypalService,
    private readonly ledger: LedgerService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async request(userId: string, orderId: string, reason: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, buyerId: userId },
      include: { request: { select: { state: true } } },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status !== 'COMPLETED') {
      throw new ConflictException({
        error: 'not_refundable',
        message: 'Only completed payments can be refunded.',
      });
    }
    const open = await this.prisma.refund.findFirst({
      where: { orderId, status: { in: [...OPEN_REFUND] } },
    });
    if (open) {
      throw new ConflictException({
        error: 'refund_already_requested',
        message: 'A refund for this payment is already being handled.',
      });
    }

    const missedDelivery = order.request?.state === 'OVERDUE';
    const refund = await this.prisma.refund.create({
      data: {
        orderId,
        amountCents: order.amountCents,
        reason,
        requestedBy: userId,
        status: missedDelivery ? 'APPROVED' : 'REQUESTED',
        decisionNote: missedDelivery
          ? 'Approved automatically: the response was not delivered on time.'
          : null,
      },
    });
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'refund.requested',
      subjectType: 'refund',
      subjectId: refund.id,
      details: { orderId, automatic: missedDelivery },
    });
    if (missedDelivery) await this.execute(refund.id);
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
  }

  async decide(
    adminId: string,
    refundId: string,
    approve: boolean,
    note: string | undefined,
  ) {
    const updated = await this.prisma.refund.updateMany({
      where: { id: refundId, status: 'REQUESTED' },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        decidedBy: adminId,
        decisionNote: note ?? null,
      },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        error: 'refund_not_pending',
        message: 'This refund has already been decided.',
      });
    }
    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: approve ? 'refund.approved' : 'refund.rejected',
      subjectType: 'refund',
      subjectId: refundId,
    });
    if (approve) await this.execute(refundId);
    return this.prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  }

  /** Sends an approved refund to PayPal. */
  async execute(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { order: true },
    });
    if (refund.status !== 'APPROVED') return;
    if (!refund.order.paypalCaptureId) {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          decisionNote: 'No PayPal capture to refund.',
        },
      });
      return;
    }

    let result: PaypalRefund;
    try {
      result = await this.paypal.refundCapture(
        refund.order.paypalCaptureId,
        `refund-${refund.id}`,
      );
    } catch (error) {
      const issue =
        error instanceof PaypalError
          ? (error.issue ?? `http_${error.status}`)
          : 'refund_error';
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: {
          status: 'FAILED',
          decisionNote: `PayPal refused the refund (${issue}).`,
        },
      });
      throw new BadGatewayException({
        error: 'refund_failed',
        message: 'PayPal did not accept the refund. An admin will follow up.',
      });
    }

    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { status: 'SUBMITTED', paypalRefundId: result.id },
    });
    if (result.status === 'COMPLETED') await this.complete(refund.id);
  }

  /** PAYMENT.CAPTURE.REFUNDED: also covers refunds issued from the PayPal dashboard. */
  async handleRefundEvent(resource: PaypalRefund): Promise<string> {
    if (resource.status !== 'COMPLETED') return `refund ${resource.status}`;
    const known = await this.prisma.refund.findUnique({
      where: { paypalRefundId: resource.id },
    });
    if (known) {
      await this.complete(known.id);
      return 'refund completed';
    }

    const captureId = resource.links
      ?.find((link) => link.rel === 'up')
      ?.href.split('/')
      .pop();
    const order = captureId
      ? await this.prisma.order.findUnique({
          where: { paypalCaptureId: captureId },
        })
      : null;
    if (!order) return 'refund for unknown capture';
    const created = await this.prisma.refund.create({
      data: {
        orderId: order.id,
        amountCents: order.amountCents,
        reason: 'Refunded outside EnrichMINT (PayPal dashboard).',
        requestedBy: order.buyerId,
        status: 'SUBMITTED',
        paypalRefundId: resource.id,
      },
    });
    await this.complete(created.id);
    return 'external refund recorded';
  }

  /** PAYMENT.CAPTURE.REVERSED: a chargeback or reversal, treated like a refund the platform did not start. */
  async handleReversal(captureId: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { paypalCaptureId: captureId },
      });
      if (!order) return 'reversal for unknown capture';
      const moved = await tx.order.updateMany({
        where: { id: order.id, status: 'COMPLETED' },
        data: { status: 'REVERSED' },
      });
      if (moved.count === 0) return 'already reversed';
      await this.reverseEffects(tx, order.id, null);
      return 'reversal recorded';
    });
  }

  listMine(userId: string) {
    return this.prisma.refund.findMany({
      where: { order: { buyerId: userId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  listForAdmin() {
    return this.prisma.refund.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: {
          select: {
            id: true,
            kind: true,
            amountCents: true,
            buyerId: true,
            guideId: true,
            requestId: true,
          },
        },
      },
    });
  }

  private async complete(refundId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
      });
      const marked = await tx.refund.updateMany({
        where: { id: refundId, status: { in: [...OPEN_REFUND] } },
        data: { status: 'COMPLETED' },
      });
      if (marked.count === 0) return;
      const moved = await tx.order.updateMany({
        where: { id: refund.orderId, status: 'COMPLETED' },
        data: { status: 'REFUNDED' },
      });
      if (moved.count === 0) return;
      await this.reverseEffects(tx, refund.orderId, refund.id);
      await this.audit.record(
        {
          actorType: 'SYSTEM',
          action: 'refund.completed',
          subjectType: 'refund',
          subjectId: refund.id,
        },
        tx,
      );
    });
  }

  private async reverseEffects(
    tx: TransactionClient,
    orderId: string,
    refundId: string | null,
  ): Promise<void> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        guide: { select: { contributorId: true } },
        request: { select: { id: true, contributorId: true, state: true } },
      },
    });
    const contributorId =
      order.guide?.contributorId ?? order.request?.contributorId;
    if (contributorId)
      await this.ledger.recordRefund(tx, order, contributorId, refundId);
    await this.entitlements.revokeForOrder(tx, order.id, 'REVOKED_REFUND');

    if (order.request) {
      const event =
        order.request.state === 'DISPUTED' ? 'resolve_refund' : 'refund';
      try {
        await applyTransition(tx, {
          requestId: order.request.id,
          event,
          actor: 'SYSTEM',
          reason: 'Payment refunded',
        });
      } catch {
        // A delivered-and-closed request keeps its state; the refund is still recorded.
        this.logger.log(
          `Request ${order.request.id} kept state ${order.request.state} after refund.`,
        );
      }
    }
  }
}
