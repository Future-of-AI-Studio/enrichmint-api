import { ForbiddenException, Injectable } from '@nestjs/common';
import { wrapUntrusted } from 'src/common/utils/prompt.util';
import { EntitlementsService } from 'src/entitlements/entitlements.service';
import { sectionsFrom } from 'src/guides/constants/guide-sections.constants';
import { PolicyService } from 'src/policy/policy.service';
import { PrismaService } from 'src/prisma/prisma.service';
import type { SourceText } from './utils/attribution.util';

export interface GroundingContext {
  entitlementId: string;
  guide: {
    id: string;
    title: string;
    contributorId: string;
    contributorName: string;
  };
  sources: SourceText[];
  /** Prompt-ready text. Contributor content is wrapped as untrusted data. */
  promptText: string;
}

/**
 * The ONLY place guide content becomes prompt text. It requires an active
 * entitlement and the contributor's permission for AI assistance; if either
 * is missing, no content leaves the database.
 */
@Injectable()
export class GroundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly policy: PolicyService,
  ) {}

  async loadGuideContext(
    userId: string,
    guideId: string,
  ): Promise<GroundingContext> {
    const entitlement = await this.entitlements.requireActive(userId, guideId);
    const guide = await this.prisma.guide.findUniqueOrThrow({
      where: { id: guideId },
      select: {
        id: true,
        title: true,
        agentAssistAllowed: true,
        contributorId: true,
        contributor: { select: { user: { select: { displayName: true } } } },
      },
    });

    if (!guide.agentAssistAllowed) {
      await this.policy.note(
        {
          userId,
          check: 'agent_access',
          subjectType: 'guide',
          subjectId: guideId,
        },
        'DENY',
        `${guide.contributor.user.displayName} has not allowed AI assistance for this guide, so the assistant did not read it. You can still read the whole guide yourself.`,
      );
      throw new ForbiddenException({
        error: 'agent_access_not_permitted',
        message: `${guide.contributor.user.displayName} has not allowed AI assistance for this guide. You can still read it in full.`,
      });
    }

    const version = await this.prisma.guideVersion.findUniqueOrThrow({
      where: { id: entitlement.purchasedVersionId },
      select: { sections: true, limitations: true },
    });
    const sources: SourceText[] = sectionsFrom(version.sections)
      .filter((section) => section.body.trim())
      .map((section) => ({
        id: section.id,
        title: section.title,
        body: section.body,
      }));

    return {
      entitlementId: entitlement.id,
      guide: {
        id: guide.id,
        title: guide.title,
        contributorId: guide.contributorId,
        contributorName: guide.contributor.user.displayName,
      },
      sources,
      promptText: sourcesPrompt(sources),
    };
  }
}

/** Renders sources as untrusted prompt data. Exported so `yarn eval:agents` renders fixtures the same way. */
export function sourcesPrompt(sources: SourceText[]): string {
  return sources
    .map((source) =>
      wrapUntrusted('contributor_source', `${source.title}\n${source.body}`, {
        id: source.id,
      }),
    )
    .join('\n\n');
}
