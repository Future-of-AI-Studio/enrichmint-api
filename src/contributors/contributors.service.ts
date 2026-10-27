import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { env } from 'src/config/env';
import { AuditService } from 'src/audit/audit.service';
import { formatUsd } from 'src/common/utils/money.util';
import { PrismaService } from 'src/prisma/prisma.service';
import type {
  ApplyContributorDto,
  UpdateContributorDto,
} from './dto/contributor.dto';

const OWN_PROFILE_SELECT = {
  id: true,
  headline: true,
  background: true,
  status: true,
  payoutEmail: true,
  responsePriceCents: true,
  acceptingRequests: true,
  acceptanceWindowH: true,
  deliveryH: true,
  boundaries: true,
  createdAt: true,
} as const;

@Injectable()
export class ContributorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Creates a PENDING profile. An admin approves it before anything is sold. */
  async apply(userId: string, dto: ApplyContributorDto) {
    const existing = await this.prisma.contributorProfile.findUnique({
      where: { userId },
      select: OWN_PROFILE_SELECT,
    });
    if (existing) return existing;
    const profile = await this.prisma.contributorProfile.create({
      data: { userId, headline: dto.headline, background: dto.background },
      select: OWN_PROFILE_SELECT,
    });
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'contributor.applied',
      subjectType: 'contributor',
      subjectId: profile.id,
    });
    return profile;
  }

  async me(contributorId: string) {
    return this.prisma.contributorProfile.findUniqueOrThrow({
      where: { id: contributorId },
      select: OWN_PROFILE_SELECT,
    });
  }

  async update(contributorId: string, dto: UpdateContributorDto) {
    if (
      dto.responsePriceCents !== undefined &&
      dto.responsePriceCents !== 0 &&
      (dto.responsePriceCents < env.MIN_PRICE_CENTS ||
        dto.responsePriceCents > env.MAX_PRICE_CENTS)
    ) {
      throw new BadRequestException({
        error: 'price_out_of_range',
        message: `Prices must be between ${formatUsd(env.MIN_PRICE_CENTS)} and ${formatUsd(env.MAX_PRICE_CENTS)}.`,
      });
    }
    const current = await this.me(contributorId);
    const price = dto.responsePriceCents ?? current.responsePriceCents;
    if ((dto.acceptingRequests ?? current.acceptingRequests) && !price) {
      throw new BadRequestException({
        error: 'response_price_required',
        message: 'Set a response price before accepting requests.',
      });
    }
    return this.prisma.contributorProfile.update({
      where: { id: contributorId },
      data: dto,
      select: OWN_PROFILE_SELECT,
    });
  }

  async publicProfile(contributorId: string) {
    const profile = await this.prisma.contributorProfile.findFirst({
      where: { id: contributorId, status: 'APPROVED' },
      select: {
        id: true,
        headline: true,
        background: true,
        responsePriceCents: true,
        acceptingRequests: true,
        deliveryH: true,
        boundaries: true,
        user: { select: { displayName: true, isDemo: true } },
        guides: {
          where: { status: 'PUBLISHED' },
          select: { id: true, slug: true, title: true, priceCents: true },
        },
      },
    });
    if (!profile) throw new NotFoundException('Contributor not found.');
    return profile;
  }

  listForAdmin(status?: 'PENDING' | 'APPROVED' | 'SUSPENDED') {
    return this.prisma.contributorProfile.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        ...OWN_PROFILE_SELECT,
        user: { select: { id: true, displayName: true, isDemo: true } },
        _count: { select: { guides: true } },
      },
    });
  }

  async setStatus(
    adminId: string,
    contributorId: string,
    status: 'APPROVED' | 'SUSPENDED',
  ) {
    const updated = await this.prisma.contributorProfile.update({
      where: { id: contributorId },
      data: { status },
      select: OWN_PROFILE_SELECT,
    });
    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: `contributor.${status.toLowerCase()}`,
      subjectType: 'contributor',
      subjectId: contributorId,
    });
    return updated;
  }
}
