import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { env } from 'src/config/env';
import { CurrentUser } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { PayeeGuard } from 'src/common/guards/payee.guard';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { LedgerService } from 'src/ledger/ledger.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PayoutsService } from './payouts.service';

@ApiTags('Earnings')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard, PayeeGuard)
@Controller()
export class EarningsController {
  constructor(
    private readonly ledger: LedgerService,
    private readonly payouts: PayoutsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('earnings/me')
  @ApiOperation({
    summary:
      'Contributor: earned, available, payout pending and transferred amounts, kept separate, plus each sale with its fee breakdown',
  })
  async me(@CurrentUser() user: AuthenticatedUser) {
    const contributorId = user.contributorId!;
    const [balances, entries, payouts, sales] = await Promise.all([
      this.ledger.balances(contributorId),
      this.ledger.entries(contributorId),
      this.payouts.listMine(contributorId),
      this.prisma.order.findMany({
        where: {
          status: { in: ['COMPLETED', 'REFUNDED', 'REVERSED'] },
          OR: [{ guide: { contributorId } }, { request: { contributorId } }],
        },
        orderBy: { completedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          kind: true,
          status: true,
          amountCents: true,
          currency: true,
          commissionBps: true,
          paypalFeeCents: true,
          paypalCaptureId: true,
          completedAt: true,
          guide: { select: { title: true } },
          request: { select: { id: true, question: true } },
        },
      }),
    ]);
    return {
      balances,
      commissionBps: env.COMMISSION_BPS,
      paymentEnvironment: env.PAYPAL_ENV,
      sales: sales.map((sale) => {
        const commissionCents = Math.round(
          (sale.amountCents * sale.commissionBps) / 10_000,
        );
        return {
          ...sale,
          request: sale.request
            ? {
                id: sale.request.id,
                question: sale.request.question.slice(0, 120),
              }
            : null,
          commissionCents,
          contributorShareCents: sale.amountCents - commissionCents,
          processingFeePaidByPlatformCents: sale.paypalFeeCents ?? 0,
        };
      }),
      entries,
      payouts,
    };
  }

  @Post('payouts')
  @ApiOperation({
    summary:
      'Contributor: send my available balance to my PayPal (sandbox) email',
  })
  request(@CurrentUser() user: AuthenticatedUser) {
    return this.payouts.request(user.contributorId!, user.id);
  }
}
