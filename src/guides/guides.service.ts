import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from 'generated/prisma/client';
import { env } from 'src/config/env';
import { AuditService } from 'src/audit/audit.service';
import type { AuthenticatedUser } from 'src/common/types/authenticated-request.type';
import { getPagination, toPaginated } from 'src/common/utils/list-query.util';
import { formatUsd } from 'src/common/utils/money.util';
import { EntitlementsService } from 'src/entitlements/entitlements.service';
import {
  EMPTY_STATS,
  feedbackStats,
} from 'src/feedback/utils/feedback-stats.util';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  GUIDE_SECTIONS,
  sectionsFrom,
} from './constants/guide-sections.constants';
import type {
  ListGuidesQueryDto,
  UpdateDraftDto,
  UpdateGuideSettingsDto,
} from './dto/guide.dto';

/** What anyone may see before buying. Section bodies are never in here. */
export const PUBLIC_GUIDE_SELECT = {
  id: true,
  slug: true,
  title: true,
  priceCents: true,
  currency: true,
  topics: true,
  agentAssistAllowed: true,
  isDemo: true,
  category: { select: { slug: true, name: true } },
  contributor: {
    select: {
      id: true,
      headline: true,
      background: true,
      acceptingRequests: true,
      responsePriceCents: true,
      deliveryH: true,
      user: { select: { displayName: true, isDemo: true } },
    },
  },
  currentVersion: {
    select: {
      id: true,
      number: true,
      summary: true,
      preview: true,
      audience: true,
      limitations: true,
      claimLabel: true,
      publishedAt: true,
      sections: true,
    },
  },
} satisfies Prisma.GuideSelect;

type PublicGuideRow = Prisma.GuideGetPayload<{
  select: typeof PUBLIC_GUIDE_SELECT;
}>;

@Injectable()
export class GuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
  ) {}

  async listPublic(query: ListGuidesQueryDto) {
    const pagination = getPagination(query);
    const search = query.search?.trim();
    const where: Prisma.GuideWhereInput = {
      status: 'PUBLISHED',
      currentVersionId: { not: null },
      contributor: { status: 'APPROVED' },
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { topics: { has: search.toLowerCase() } },
              {
                currentVersion: {
                  summary: { contains: search, mode: 'insensitive' },
                },
              },
              {
                currentVersion: {
                  preview: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.guide.findMany({
        where,
        select: PUBLIC_GUIDE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.guide.count({ where }),
    ]);
    return toPaginated(await this.toPublic(rows), total, pagination);
  }

  async getPublic(slug: string, viewer?: AuthenticatedUser) {
    const row = await this.prisma.guide.findFirst({
      where: {
        slug,
        status: { in: ['PUBLISHED', 'UNPUBLISHED'] },
        currentVersionId: { not: null },
      },
      select: { ...PUBLIC_GUIDE_SELECT, status: true },
    });
    if (!row) throw new NotFoundException('Guide not found.');
    const owned = viewer
      ? Boolean(await this.entitlements.findActive(viewer.id, row.id))
      : false;
    // Unpublished guides stay readable for people who already bought them, but are not sold.
    if (row.status !== 'PUBLISHED' && !owned)
      throw new NotFoundException('Guide not found.');
    const [view] = await this.toPublic([row]);
    return {
      ...view,
      status: row.status,
      owned,
      isOwn: viewer?.contributorId === row.contributor.id,
    };
  }

  /**
   * Full guide content. Buyers get the version they paid for; the owner and
   * admins get the latest. Nobody else gets anything.
   */
  async getContent(user: AuthenticatedUser, guideId: string) {
    const guide = await this.prisma.guide.findUnique({
      where: { id: guideId },
      select: {
        id: true,
        title: true,
        contributorId: true,
        agentAssistAllowed: true,
        currentVersionId: true,
        contributor: { select: { user: { select: { displayName: true } } } },
      },
    });
    if (!guide) throw new NotFoundException('Guide not found.');

    let versionId: string | null;
    let entitlement: Awaited<ReturnType<EntitlementsService['findActive']>> =
      null;
    if (guide.contributorId === user.contributorId || user.role === 'ADMIN') {
      const latest = await this.prisma.guideVersion.findFirst({
        where: { guideId },
        orderBy: { number: 'desc' },
        select: { id: true },
      });
      versionId = latest?.id ?? null;
    } else {
      entitlement = await this.entitlements.requireActive(user.id, guideId);
      versionId = entitlement.purchasedVersionId;
    }
    if (!versionId) throw new NotFoundException('Guide has no content yet.');

    const version = await this.prisma.guideVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    return {
      guideId: guide.id,
      title: guide.title,
      contributorName: guide.contributor.user.displayName,
      agentAssistAllowed: guide.agentAssistAllowed,
      version: {
        id: version.id,
        number: version.number,
        summary: version.summary,
        sections: sectionsFrom(version.sections),
        audience: version.audience,
        limitations: version.limitations,
        claimLabel: version.claimLabel,
        publishedAt: version.publishedAt,
      },
      isLatest: version.id === guide.currentVersionId,
      ai: entitlement
        ? {
            allowed: guide.agentAssistAllowed,
            questionsLimit: entitlement.aiQuestionsLimit,
            questionsUsed: entitlement.aiQuestionsUsed,
            expiresAt: entitlement.aiExpiresAt,
          }
        : null,
    };
  }

  /** The buyer's library: every active entitlement with the guide summary. */
  async library(userId: string) {
    const rows = await this.prisma.entitlement.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        aiQuestionsLimit: true,
        aiQuestionsUsed: true,
        aiExpiresAt: true,
        createdAt: true,
        guide: { select: PUBLIC_GUIDE_SELECT },
      },
    });
    const views = await this.toPublic(rows.map((row) => row.guide));
    return rows.map((row, index) => ({
      entitlementId: row.id,
      purchasedAt: row.createdAt,
      ai: {
        allowed: row.guide.agentAssistAllowed,
        questionsLimit: row.aiQuestionsLimit,
        questionsUsed: row.aiQuestionsUsed,
        expiresAt: row.aiExpiresAt,
      },
      guide: views[index],
    }));
  }

  mine(contributorId: string) {
    return this.prisma.guide.findMany({
      where: { contributorId, status: { not: 'REMOVED' } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        priceCents: true,
        agentAssistAllowed: true,
        currentVersionId: true,
        category: { select: { name: true } },
        versions: {
          orderBy: { number: 'desc' },
          take: 1,
          select: {
            id: true,
            number: true,
            reviewStatus: true,
            reviewNote: true,
          },
        },
        _count: { select: { entitlements: true } },
      },
    });
  }

  async getForOwner(contributorId: string, guideId: string) {
    const guide = await this.prisma.guide.findFirst({
      where: { id: guideId, contributorId },
      include: {
        category: { select: { id: true, name: true } },
        versions: { orderBy: { number: 'desc' }, take: 1 },
        permissionChanges: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!guide) throw new NotFoundException('Guide not found.');
    const [latest] = guide.versions;
    return {
      ...guide,
      versions: undefined,
      draft: latest
        ? { ...latest, sections: sectionsFrom(latest.sections) }
        : null,
    };
  }

  /**
   * Edits the newest version. A version that was submitted, approved or
   * rejected is frozen, so editing it starts a new draft version instead.
   */
  async updateDraft(
    contributorId: string,
    guideId: string,
    dto: UpdateDraftDto,
  ) {
    const guide = await this.ownGuide(contributorId, guideId);
    const latest = await this.prisma.guideVersion.findFirst({
      where: { guideId },
      orderBy: { number: 'desc' },
    });
    if (!latest) throw new NotFoundException('Guide has no draft.');
    if (latest.reviewStatus === 'PENDING') {
      throw new ConflictException({
        error: 'in_review',
        message:
          'This version is being reviewed. You can edit it after the decision.',
      });
    }

    const sections = dto.sections
      ? dto.sections.map((section) => ({
          id:
            GUIDE_SECTIONS.find((known) => known.key === section.key)?.id ??
            `x_${section.key}`,
          key: section.key,
          title: section.title,
          body: section.body,
        }))
      : undefined;
    const content = {
      summary: dto.summary,
      preview: dto.preview,
      audience: dto.audience,
      limitations: dto.limitations,
      ...(sections ? { sections } : {}),
      ...(dto.gaps ? { gaps: dto.gaps.map((gap) => ({ ...gap })) } : {}),
    };

    await this.prisma.$transaction(async (tx) => {
      if (dto.title)
        await tx.guide.update({
          where: { id: guide.id },
          data: { title: dto.title },
        });
      if (latest.reviewStatus === 'DRAFT') {
        await tx.guideVersion.update({
          where: { id: latest.id },
          data: content,
        });
      } else {
        await tx.guideVersion.create({
          data: {
            guideId,
            number: latest.number + 1,
            summary: content.summary ?? latest.summary,
            preview: content.preview ?? latest.preview,
            audience: content.audience ?? latest.audience,
            limitations: content.limitations ?? latest.limitations,
            sections: (content.sections ??
              latest.sections) as Prisma.InputJsonValue,
            gaps: (content.gaps ?? latest.gaps) as Prisma.InputJsonValue,
          },
        });
      }
    });
    return this.getForOwner(contributorId, guideId);
  }

  async updateSettings(
    user: AuthenticatedUser,
    guideId: string,
    dto: UpdateGuideSettingsDto,
  ) {
    const guide = await this.ownGuide(user.contributorId!, guideId);
    if (
      dto.priceCents !== undefined &&
      (dto.priceCents < env.MIN_PRICE_CENTS ||
        dto.priceCents > env.MAX_PRICE_CENTS)
    ) {
      throw new BadRequestException({
        error: 'price_out_of_range',
        message: `Prices must be between ${formatUsd(env.MIN_PRICE_CENTS)} and ${formatUsd(env.MAX_PRICE_CENTS)}.`,
      });
    }
    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, isActive: true },
      });
      if (!category) throw new BadRequestException('Unknown category.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.guide.update({
        where: { id: guideId },
        data: {
          priceCents: dto.priceCents,
          agentAssistAllowed: dto.agentAssistAllowed,
          topics: dto.topics
            ?.map((topic) => topic.trim().toLowerCase())
            .filter(Boolean),
          categoryId: dto.categoryId,
        },
      });
      const changes: Array<[string, string, string]> = [];
      if (
        dto.agentAssistAllowed !== undefined &&
        dto.agentAssistAllowed !== guide.agentAssistAllowed
      ) {
        changes.push([
          'agent_assist_allowed',
          String(guide.agentAssistAllowed),
          String(dto.agentAssistAllowed),
        ]);
      }
      if (dto.priceCents !== undefined && dto.priceCents !== guide.priceCents) {
        changes.push([
          'price_cents',
          String(guide.priceCents),
          String(dto.priceCents),
        ]);
      }
      if (changes.length) {
        await tx.guidePermissionChange.createMany({
          data: changes.map(([field, oldValue, newValue]) => ({
            guideId,
            field,
            oldValue,
            newValue,
            changedBy: user.id,
          })),
        });
      }
    });
    return this.getForOwner(user.contributorId!, guideId);
  }

  async submit(user: AuthenticatedUser, guideId: string) {
    const guide = await this.ownGuide(user.contributorId!, guideId);
    const latest = await this.prisma.guideVersion.findFirst({
      where: { guideId },
      orderBy: { number: 'desc' },
    });
    if (!latest || latest.reviewStatus !== 'DRAFT') {
      throw new ConflictException({
        error: 'nothing_to_submit',
        message:
          'There is no unsubmitted draft. Edit the guide to start a new version.',
      });
    }
    const missing = [
      !latest.summary.trim() && 'summary',
      !latest.preview.trim() && 'free preview',
      !latest.limitations.trim() && 'limitations',
      sectionsFrom(latest.sections).every((section) => !section.body.trim()) &&
        'sections',
      guide.priceCents < env.MIN_PRICE_CENTS && 'price',
    ].filter(Boolean);
    if (missing.length) {
      throw new BadRequestException({
        error: 'guide_incomplete',
        message: `Add these before submitting: ${missing.join(', ')}.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.guideVersion.update({
        where: { id: latest.id },
        data: { reviewStatus: 'PENDING', submittedAt: new Date() },
      });
      if (guide.status !== 'PUBLISHED') {
        await tx.guide.update({
          where: { id: guideId },
          data: { status: 'IN_REVIEW' },
        });
      }
    });
    await this.audit.record({
      actorId: user.id,
      actorType: 'USER',
      action: 'guide.submitted',
      subjectType: 'guide_version',
      subjectId: latest.id,
    });
    return this.getForOwner(user.contributorId!, guideId);
  }

  async setListed(user: AuthenticatedUser, guideId: string, listed: boolean) {
    const guide = await this.ownGuide(user.contributorId!, guideId);
    if (!guide.currentVersionId) {
      throw new ConflictException({
        error: 'not_published',
        message: 'This guide has not been published yet.',
      });
    }
    await this.prisma.guide.update({
      where: { id: guideId },
      data: { status: listed ? 'PUBLISHED' : 'UNPUBLISHED' },
    });
    return this.getForOwner(user.contributorId!, guideId);
  }

  /** Decorates public rows with feedback counts and the "what you receive" outline. */
  async toPublic(rows: PublicGuideRow[]) {
    const stats = await feedbackStats(
      this.prisma,
      'GUIDE',
      rows.map((row) => row.id),
    );
    return rows.map((row) => {
      const { currentVersion, ...rest } = row;
      return {
        ...rest,
        currentVersion: currentVersion
          ? {
              id: currentVersion.id,
              number: currentVersion.number,
              summary: currentVersion.summary,
              preview: currentVersion.preview,
              audience: currentVersion.audience,
              limitations: currentVersion.limitations,
              claimLabel: currentVersion.claimLabel,
              publishedAt: currentVersion.publishedAt,
              // Titles only: what the buyer receives, never the bodies.
              outline: sectionsFrom(currentVersion.sections).map(
                (section) => section.title,
              ),
            }
          : null,
        feedback: stats.get(row.id) ?? EMPTY_STATS,
      };
    });
  }

  private async ownGuide(contributorId: string, guideId: string) {
    const guide = await this.prisma.guide.findFirst({
      where: { id: guideId, contributorId },
    });
    if (!guide) throw new NotFoundException('Guide not found.');
    if (guide.status === 'REMOVED') {
      throw new ForbiddenException({
        error: 'guide_removed',
        message: 'This guide was removed by an admin.',
      });
    }
    return guide;
  }
}
