import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { env } from 'src/config/env';
import { Roles } from 'src/common/decorators/access.decorators';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { PrismaService } from 'src/prisma/prisma.service';

@ApiTags('Admin')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard, RoleGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Admin: queue counts and platform totals' })
  async overview() {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const [
      pendingContributors,
      pendingReviews,
      openReports,
      overdueRequests,
      disputedRequests,
      openRefunds,
      unverifiedWebhooks,
      amountMismatches,
      ledger,
      aiToday,
      aiCalls,
    ] = await Promise.all([
      this.prisma.contributorProfile.count({ where: { status: 'PENDING' } }),
      this.prisma.guideVersion.count({ where: { reviewStatus: 'PENDING' } }),
      this.prisma.report.count({ where: { status: 'OPEN' } }),
      this.prisma.personalRequest.count({ where: { state: 'OVERDUE' } }),
      this.prisma.personalRequest.count({ where: { state: 'DISPUTED' } }),
      this.prisma.refund.count({
        where: { status: { in: ['REQUESTED', 'FAILED'] } },
      }),
      this.prisma.webhookEvent.count({ where: { verified: false } }),
      this.prisma.order.count({
        where: { failureReason: 'amount_mismatch_needs_refund' },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['account'],
        _sum: { amountCents: true },
      }),
      this.prisma.modelCall.aggregate({
        _sum: { costUsd: true },
        where: { createdAt: { gte: startOfDay } },
      }),
      this.prisma.modelCall.groupBy({
        by: ['purpose'],
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
    ]);
    const total = (account: string) =>
      ledger.find((row) => row.account === account)?._sum.amountCents ?? 0;
    return {
      paymentEnvironment: env.PAYPAL_ENV,
      queues: {
        pendingContributors,
        pendingReviews,
        openReports,
        overdueRequests,
        disputedRequests,
        openRefunds,
        unverifiedWebhooks,
        amountMismatches,
      },
      money: {
        grossSalesCents: total('GROSS_SALES'),
        refundsCents: total('REFUNDS'),
        platformCommissionCents: total('PLATFORM_COMMISSION'),
        processingFeesCents: total('PROCESSING_FEE'),
        contributorPayableCents: total('CONTRIBUTOR_PAYABLE'),
        payoutsCents: total('PAYOUTS'),
        note: 'Ledger amounts are money owed or recorded, not proof of a transfer. Only payouts with status SUCCESS were transferred.',
      },
      ai: {
        spentTodayUsd: Number(aiToday._sum.costUsd ?? 0),
        dailyBudgetUsd: env.AI_DAILY_BUDGET_USD,
        byPurpose: aiCalls.map((row) => ({
          purpose: row.purpose,
          calls: row._count._all,
          costUsd: Number(row._sum.costUsd ?? 0),
        })),
      },
    };
  }

  @Get('payments')
  @ApiOperation({ summary: 'Admin: recent orders, webhook events and payouts' })
  async payments() {
    const [orders, webhookEvents, payouts] = await Promise.all([
      this.prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          kind: true,
          status: true,
          amountCents: true,
          paypalFeeCents: true,
          paypalOrderId: true,
          paypalCaptureId: true,
          failureReason: true,
          createdAt: true,
          completedAt: true,
          buyer: { select: { displayName: true } },
        },
      }),
      this.prisma.webhookEvent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          paypalEventId: true,
          type: true,
          resourceId: true,
          verified: true,
          outcome: true,
          processedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.payout.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          contributor: { select: { user: { select: { displayName: true } } } },
        },
      }),
    ]);
    return { orders, webhookEvents, payouts };
  }
}
