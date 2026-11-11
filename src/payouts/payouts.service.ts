import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PayoutStatus } from 'generated/prisma/client';
import { AuditService } from 'src/audit/audit.service';
import { LedgerService } from 'src/ledger/ledger.service';
import { PaypalError, PaypalService } from 'src/paypal/paypal.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ZapierService } from 'src/zapier/zapier.service';

const MIN_PAYOUT_CENTS = 100;

/** PayPal item statuses that mean the money came back to the platform. */
const RETURNED_STATUSES = [
  'FAILED',
  'RETURNED',
  'BLOCKED',
  'REFUNDED',
  'REVERSED',
];

/**
 * Contributor-initiated payouts through PayPal Payouts (sandbox). The amount
 * is reserved in the ledger first and returned if PayPal does not complete
 * it. Only SUCCESS is ever shown as "transferred".
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paypal: PaypalService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly zapier: ZapierService,
  ) {}

  async request(contributorId: string, actorId: string) {
    if (!this.paypal.isConfigured) {
      throw new ServiceUnavailableException({
        error: 'payments_not_configured',
        message: 'Payments are not set up on this server yet.',
      });
    }
    const profile = await this.prisma.contributorProfile.findUniqueOrThrow({
      where: { id: contributorId },
    });
    if (!profile.payoutEmail) {
      throw new BadRequestException({
        error: 'payout_email_missing',
        message:
          'Add the PayPal email that should receive your earnings first.',
      });
    }
    const open = await this.prisma.payout.findFirst({
      where: { contributorId, status: { in: ['REQUESTED', 'PENDING'] } },
    });
    if (open) {
      throw new ConflictException({
        error: 'payout_in_progress',
        message: 'A payout is already on its way. Wait for it to finish.',
      });
    }
    const { availableCents } = await this.ledger.balances(contributorId);
    if (availableCents < MIN_PAYOUT_CENTS) {
      throw new ConflictException({
        error: 'nothing_to_pay_out',
        message: 'You need at least $1.00 available to request a payout.',
      });
    }

    const payout = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payout.create({
        data: {
          contributorId,
          amountCents: availableCents,
          receiverEmail: profile.payoutEmail!,
        },
      });
      await this.ledger.recordPayout(tx, created);
      return created;
    });

    try {
      const result = await this.paypal.createPayout({
        payoutId: payout.id,
        receiverEmail: payout.receiverEmail,
        amountCents: payout.amountCents,
        currency: payout.currency,
      });
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: {
          status: 'PENDING',
          paypalBatchId: result.batch_header.payout_batch_id,
        },
      });
    } catch (error) {
      const reason =
        error instanceof PaypalError &&
        (error.status === 403 || error.issue === 'AUTHORIZATION_ERROR')
          ? 'payouts_not_enabled'
          : error instanceof PaypalError
            ? (error.issue ?? `http_${error.status}`)
            : 'payout_error';
      await this.fail(payout.id, 'FAILED', reason);
    }

    await this.audit.record({
      actorId,
      actorType: 'USER',
      action: 'payout.requested',
      subjectType: 'payout',
      subjectId: payout.id,
      details: { amountCents: payout.amountCents },
    });
    return this.prisma.payout.findUniqueOrThrow({ where: { id: payout.id } });
  }

  /** From PAYMENT.PAYOUTS-ITEM.* webhooks and the reconciler. */
  async applyItemStatus(
    batchId: string,
    itemId: string | null,
    transactionStatus: string,
  ): Promise<string> {
    const payout = await this.prisma.payout.findUnique({
      where: { paypalBatchId: batchId },
    });
    if (!payout) return 'payout for unknown batch';
    if (itemId && !payout.paypalItemId) {
      await this.prisma.payout.update({
        where: { id: payout.id },
        data: { paypalItemId: itemId },
      });
    }

    if (transactionStatus === 'SUCCESS') {
      const succeeded = await this.prisma.payout.updateMany({
        where: { id: payout.id, status: { in: ['PENDING', 'UNCLAIMED'] } },
        data: { status: 'SUCCESS' },
      });
      if (succeeded.count > 0) {
        this.zapier.notify('payout.succeeded', {
          payoutId: payout.id,
          amountCents: payout.amountCents,
          paypalBatchId: batchId,
        });
      }
      return 'payout succeeded';
    }
    if (transactionStatus === 'UNCLAIMED') {
      await this.prisma.payout.updateMany({
        where: { id: payout.id, status: 'PENDING' },
        data: {
          status: 'UNCLAIMED',
          failureReason: 'The receiver has not claimed the payment yet.',
        },
      });
      return 'payout unclaimed';
    }
    if (RETURNED_STATUSES.includes(transactionStatus)) {
      const status: PayoutStatus =
        transactionStatus === 'BLOCKED'
          ? 'BLOCKED'
          : transactionStatus === 'RETURNED'
            ? 'RETURNED'
            : 'FAILED';
      await this.fail(payout.id, status, transactionStatus.toLowerCase());
      return `payout ${transactionStatus.toLowerCase()}`;
    }
    return `payout ${transactionStatus.toLowerCase()}`;
  }

  async reconcile(): Promise<void> {
    if (!this.paypal.isConfigured) return;
    const pending = await this.prisma.payout.findMany({
      where: {
        status: { in: ['PENDING', 'UNCLAIMED'] },
        paypalBatchId: { not: null },
      },
      take: 50,
    });
    for (const payout of pending) {
      try {
        const batch = await this.paypal.getPayoutBatch(payout.paypalBatchId!);
        const item = batch.items[0];
        if (item?.transaction_status) {
          await this.applyItemStatus(
            payout.paypalBatchId!,
            item.payout_item_id,
            item.transaction_status,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Payout reconcile ${payout.id} failed: ${String(error)}`,
        );
      }
    }
  }

  listMine(contributorId: string) {
    return this.prisma.payout.findMany({
      where: { contributorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async fail(
    payoutId: string,
    status: PayoutStatus,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.payout.updateMany({
        where: {
          id: payoutId,
          status: { in: ['REQUESTED', 'PENDING', 'UNCLAIMED'] },
        },
        data: { status, failureReason: reason },
      });
      if (moved.count === 0) return;
      const payout = await tx.payout.findUniqueOrThrow({
        where: { id: payoutId },
      });
      await this.ledger.reversePayout(tx, payout, reason);
    });
  }
}
