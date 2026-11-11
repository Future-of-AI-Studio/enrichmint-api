import { Injectable } from '@nestjs/common';
import type { LedgerAccount } from 'generated/prisma/client';
import { env } from 'src/config/env';
import { bpsOf } from 'src/common/utils/money.util';
import { PrismaService, TransactionClient } from 'src/prisma/prisma.service';

export interface SaleSplit {
  grossCents: number;
  commissionCents: number;
  contributorCents: number;
  processingFeeCents: number;
  platformNetCents: number;
}

/**
 * The split for one sale. The platform pays the processing fee out of its
 * commission, so the contributor share is always gross minus commission.
 */
export function splitSale(
  grossCents: number,
  commissionBps: number,
  processingFeeCents: number,
): SaleSplit {
  const commissionCents = bpsOf(grossCents, commissionBps);
  return {
    grossCents,
    commissionCents,
    contributorCents: grossCents - commissionCents,
    processingFeeCents,
    platformNetCents: commissionCents - processingFeeCents,
  };
}

export interface EnrichmentShare {
  contributorId: string;
  cents: number;
}

/**
 * Field note shares for one sale: a pool of `bps` of the gross, paid out of the
 * platform commission and split evenly; leftover cents go to the earliest notes.
 */
export function splitEnrichment(
  grossCents: number,
  bps: number,
  payeeIds: string[],
): EnrichmentShare[] {
  const payees = [...new Set(payeeIds)];
  if (payees.length === 0 || bps <= 0) return [];
  const pool = bpsOf(grossCents, bps);
  const base = Math.floor(pool / payees.length);
  const remainder = pool - base * payees.length;
  return payees
    .map((contributorId, index) => ({
      contributorId,
      cents: base + (index < remainder ? 1 : 0),
    }))
    .filter((share) => share.cents > 0);
}

interface EntryInput {
  account: LedgerAccount;
  amountCents: number;
  memo: string;
  availableAt?: Date;
}

/**
 * Append-only, signed ledger. A ledger balance is money owed, not money moved:
 * only a Payout with status SUCCESS means a transfer happened.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async recordSale(
    tx: TransactionClient,
    order: {
      id: string;
      amountCents: number;
      currency: string;
      commissionBps: number;
      kind: string;
    },
    contributorId: string,
    processingFeeCents: number,
    enrichment: EnrichmentShare[] = [],
  ): Promise<SaleSplit> {
    const split = splitSale(
      order.amountCents,
      order.commissionBps,
      processingFeeCents,
    );
    const availableAt = new Date(
      Date.now() + env.PAYOUT_HOLD_HOURS * 3_600_000,
    );
    const label = order.kind === 'GUIDE' ? 'Guide sale' : 'Personal response';
    await this.write(tx, contributorId, order.currency, { orderId: order.id }, [
      { account: 'GROSS_SALES', amountCents: split.grossCents, memo: label },
      {
        account: 'PLATFORM_COMMISSION',
        amountCents: split.commissionCents,
        memo: `${label}: platform commission`,
      },
      {
        account: 'CONTRIBUTOR_PAYABLE',
        amountCents: split.contributorCents,
        memo: `${label}: your share`,
        availableAt,
      },
      {
        account: 'PROCESSING_FEE',
        amountCents: -split.processingFeeCents,
        memo: `${label}: PayPal fee (paid by platform)`,
      },
    ]);
    for (const share of enrichment) {
      // The author's 85% is untouched: each field note share comes out of the platform commission.
      await this.write(
        tx,
        contributorId,
        order.currency,
        { orderId: order.id },
        [
          {
            account: 'PLATFORM_COMMISSION',
            amountCents: -share.cents,
            memo: `${label}: field note share paid from platform commission`,
          },
        ],
      );
      await this.write(
        tx,
        share.contributorId,
        order.currency,
        { orderId: order.id },
        [
          {
            account: 'CONTRIBUTOR_PAYABLE',
            amountCents: share.cents,
            memo: 'Field note share',
            availableAt,
          },
        ],
      );
    }
    return split;
  }

  /** Reverses a sale after a refund or reversal. PayPal keeps its original fee, so that entry stays. */
  async recordRefund(
    tx: TransactionClient,
    order: {
      id: string;
      amountCents: number;
      currency: string;
      commissionBps: number;
    },
    contributorId: string,
    refundId: string | null,
  ): Promise<void> {
    const split = splitSale(order.amountCents, order.commissionBps, 0);
    await this.write(
      tx,
      contributorId,
      order.currency,
      { orderId: order.id, refundId },
      [
        {
          account: 'REFUNDS',
          amountCents: -split.grossCents,
          memo: 'Refund to buyer',
        },
        {
          account: 'PLATFORM_COMMISSION',
          amountCents: -split.commissionCents,
          memo: 'Refund: commission returned',
        },
        {
          account: 'CONTRIBUTOR_PAYABLE',
          amountCents: -split.contributorCents,
          memo: 'Refund: your share reversed',
        },
      ],
    );
    // Field note shares on this sale are reversed too, read back from the sale's own rows.
    const shares = await tx.ledgerEntry.groupBy({
      by: ['contributorId'],
      where: {
        orderId: order.id,
        account: 'CONTRIBUTOR_PAYABLE',
        refundId: null,
        payoutId: null,
        contributorId: { not: contributorId },
      },
      _sum: { amountCents: true },
    });
    for (const share of shares) {
      const cents = share._sum.amountCents ?? 0;
      if (!share.contributorId || cents <= 0) continue;
      await this.write(
        tx,
        contributorId,
        order.currency,
        { orderId: order.id, refundId },
        [
          {
            account: 'PLATFORM_COMMISSION',
            amountCents: cents,
            memo: 'Refund: field note share returned to platform',
          },
        ],
      );
      await this.write(
        tx,
        share.contributorId,
        order.currency,
        { orderId: order.id, refundId },
        [
          {
            account: 'CONTRIBUTOR_PAYABLE',
            amountCents: -cents,
            memo: 'Refund: field note share reversed',
          },
        ],
      );
    }
  }

  /** Reserves the payout amount when it is requested; `reversePayout` returns it if PayPal fails. */
  async recordPayout(
    tx: TransactionClient,
    payout: {
      id: string;
      contributorId: string;
      amountCents: number;
      currency: string;
    },
  ): Promise<void> {
    await this.write(
      tx,
      payout.contributorId,
      payout.currency,
      { payoutId: payout.id },
      [
        {
          account: 'CONTRIBUTOR_PAYABLE',
          amountCents: -payout.amountCents,
          memo: 'Payout requested',
        },
        {
          account: 'PAYOUTS',
          amountCents: payout.amountCents,
          memo: 'Payout requested',
        },
      ],
    );
  }

  async reversePayout(
    tx: TransactionClient,
    payout: {
      id: string;
      contributorId: string;
      amountCents: number;
      currency: string;
    },
    reason: string,
  ): Promise<void> {
    await this.write(
      tx,
      payout.contributorId,
      payout.currency,
      { payoutId: payout.id },
      [
        {
          account: 'CONTRIBUTOR_PAYABLE',
          amountCents: payout.amountCents,
          memo: `Payout not completed (${reason}): returned to balance`,
        },
        {
          account: 'PAYOUTS',
          amountCents: -payout.amountCents,
          memo: `Payout ${reason}`,
        },
      ],
    );
  }

  /** Four separate amounts, so "earned" is never mistaken for "transferred". */
  async balances(contributorId: string) {
    const now = new Date();
    const [earned, refunded, available, payouts] = await Promise.all([
      this.sum({
        contributorId,
        account: 'CONTRIBUTOR_PAYABLE',
        orderId: { not: null },
        amountCents: { gt: 0 },
      }),
      this.sum({
        contributorId,
        account: 'CONTRIBUTOR_PAYABLE',
        refundId: { not: null },
      }),
      this.sum({
        contributorId,
        account: 'CONTRIBUTOR_PAYABLE',
        availableAt: { lte: now },
      }),
      this.prisma.payout.groupBy({
        by: ['status'],
        where: { contributorId },
        _sum: { amountCents: true },
      }),
    ]);
    const payoutSum = (statuses: string[]) =>
      payouts
        .filter((row) => statuses.includes(row.status))
        .reduce((total, row) => total + (row._sum.amountCents ?? 0), 0);

    return {
      currency: 'USD',
      earnedCents: earned + refunded,
      availableCents: available,
      payoutPendingCents: payoutSum(['REQUESTED', 'PENDING']),
      transferredCents: payoutSum(['SUCCESS']),
    };
  }

  entries(contributorId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: {
        contributorId,
        account: {
          in: [
            'GROSS_SALES',
            'PLATFORM_COMMISSION',
            'PROCESSING_FEE',
            'CONTRIBUTOR_PAYABLE',
            'REFUNDS',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        account: true,
        amountCents: true,
        currency: true,
        memo: true,
        orderId: true,
        refundId: true,
        payoutId: true,
        availableAt: true,
        createdAt: true,
      },
    });
  }

  private async sum(where: Record<string, unknown>): Promise<number> {
    const result = await this.prisma.ledgerEntry.aggregate({
      _sum: { amountCents: true },
      where,
    });
    return result._sum.amountCents ?? 0;
  }

  private async write(
    tx: TransactionClient,
    contributorId: string,
    currency: string,
    links: { orderId?: string; refundId?: string | null; payoutId?: string },
    entries: EntryInput[],
  ): Promise<void> {
    await tx.ledgerEntry.createMany({
      data: entries.map((entry) => ({
        contributorId,
        currency,
        orderId: links.orderId ?? null,
        refundId: links.refundId ?? null,
        payoutId: links.payoutId ?? null,
        account: entry.account,
        amountCents: entry.amountCents,
        memo: entry.memo,
        availableAt: entry.availableAt ?? new Date(),
      })),
    });
  }
}
