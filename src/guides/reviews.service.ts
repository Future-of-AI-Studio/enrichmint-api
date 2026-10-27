import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from 'src/audit/audit.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { sectionsFrom } from './constants/guide-sections.constants';

/** Text in a guide that looks like an instruction to an AI system. Flagged for the reviewer, never auto-removed. */
const INSTRUCTION_PATTERN =
  /\b(ignore (all|any|previous|the above)|system prompt|you are (an?|the) (ai|assistant)|disregard (your|the) (rules|instructions)|buy (this|now)|purchase immediately)\b/i;

/** Manual review: every guide version is approved by an admin before buyers can see it. */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async queue() {
    const versions = await this.prisma.guideVersion.findMany({
      where: { reviewStatus: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      include: {
        guide: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            agentAssistAllowed: true,
            status: true,
            category: { select: { name: true } },
            contributor: {
              select: {
                id: true,
                status: true,
                headline: true,
                user: { select: { displayName: true } },
              },
            },
          },
        },
      },
    });
    return versions.map((version) => {
      const sections = sectionsFrom(version.sections);
      const text = [
        version.summary,
        version.preview,
        ...sections.map((section) => section.body),
      ].join('\n');
      return {
        ...version,
        sections,
        flags: INSTRUCTION_PATTERN.test(text)
          ? [
              'Contains text that looks like instructions to an AI. Check it is not a prompt injection.',
            ]
          : [],
      };
    });
  }

  async approve(adminId: string, versionId: string) {
    const version = await this.pending(versionId);
    if (version.guide.contributor.status !== 'APPROVED') {
      throw new ConflictException({
        error: 'contributor_not_approved',
        message: 'Approve the contributor before publishing their guide.',
      });
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.guideVersion.update({
        where: { id: versionId },
        data: {
          reviewStatus: 'APPROVED',
          reviewerId: adminId,
          reviewedAt: now,
          publishedAt: now,
        },
      });
      await tx.guide.update({
        where: { id: version.guideId },
        data: { currentVersionId: versionId, status: 'PUBLISHED' },
      });
      await this.audit.record(
        {
          actorId: adminId,
          actorType: 'ADMIN',
          action: 'guide.approved',
          subjectType: 'guide_version',
          subjectId: versionId,
        },
        tx,
      );
    });
    return { id: versionId, reviewStatus: 'APPROVED' };
  }

  async reject(adminId: string, versionId: string, note: string | undefined) {
    if (!note?.trim()) {
      throw new BadRequestException({
        error: 'note_required',
        message: 'Tell the contributor what to change.',
      });
    }
    const version = await this.pending(versionId);
    await this.prisma.$transaction(async (tx) => {
      await tx.guideVersion.update({
        where: { id: versionId },
        data: {
          reviewStatus: 'REJECTED',
          reviewerId: adminId,
          reviewedAt: new Date(),
          reviewNote: note,
        },
      });
      if (!version.guide.currentVersionId) {
        await tx.guide.update({
          where: { id: version.guideId },
          data: { status: 'DRAFT' },
        });
      }
      await this.audit.record(
        {
          actorId: adminId,
          actorType: 'ADMIN',
          action: 'guide.rejected',
          subjectType: 'guide_version',
          subjectId: versionId,
        },
        tx,
      );
    });
    return { id: versionId, reviewStatus: 'REJECTED' };
  }

  /** Policy removal: hides the guide everywhere and revokes buyer access. Refunds are handled separately. */
  async remove(adminId: string, guideId: string, note: string | undefined) {
    await this.prisma.$transaction(async (tx) => {
      await tx.guide.update({
        where: { id: guideId },
        data: { status: 'REMOVED' },
      });
      await tx.entitlement.updateMany({
        where: { guideId, status: 'ACTIVE' },
        data: { status: 'REVOKED_ADMIN' },
      });
      await this.audit.record(
        {
          actorId: adminId,
          actorType: 'ADMIN',
          action: 'guide.removed',
          subjectType: 'guide',
          subjectId: guideId,
          details: { note: note ?? '' },
        },
        tx,
      );
    });
    return { id: guideId, status: 'REMOVED' };
  }

  private async pending(versionId: string) {
    const version = await this.prisma.guideVersion.findUnique({
      where: { id: versionId },
      include: {
        guide: {
          select: {
            currentVersionId: true,
            contributor: { select: { status: true } },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Version not found.');
    if (version.reviewStatus !== 'PENDING') {
      throw new ConflictException({
        error: 'not_pending',
        message: 'This version is not waiting for review.',
      });
    }
    return version;
  }
}
