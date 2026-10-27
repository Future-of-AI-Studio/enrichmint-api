/* Seeds labelled demo data: categories, an admin, Maria, Alex and a few other fictional contributors. Idempotent. */
import { Logger } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { Pool } from 'pg';
import { env } from 'src/config/env';
import {
  BCRYPT_ROUNDS,
  PASSWORD_MIN_LENGTH,
} from 'src/common/constants/auth.constants';
import { GUIDE_SECTIONS } from 'src/guides/constants/guide-sections.constants';
import { PrismaClient } from '../../../generated/prisma/client';
import {
  ALEX,
  CATEGORIES,
  DemoContributor,
  MARIA,
  OTHER_CONTRIBUTORS,
} from './demo-content';

const logger = new Logger('DemoSeeder');

async function main(): Promise<void> {
  if (env.ENVIRONMENT === 'production')
    throw new Error('Refusing to seed demo data in production.');
  const password = env.SEED_DEMO_PASSWORD;
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `Set SEED_DEMO_PASSWORD (at least ${PASSWORD_MIN_LENGTH} characters) to seed demo accounts.`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(new Pool({ connectionString: env.DATABASE_URL })),
  });
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      create: category,
      update: category,
    });
  }
  const categories = new Map(
    (await prisma.category.findMany()).map((row) => [row.slug, row.id]),
  );

  await prisma.user.upsert({
    where: { email: env.SEED_ADMIN_EMAIL },
    create: {
      email: env.SEED_ADMIN_EMAIL,
      displayName: 'EnrichMINT Admin',
      passwordHash,
      role: 'ADMIN',
      isDemo: true,
    },
    update: { role: 'ADMIN' },
  });
  await prisma.user.upsert({
    where: { email: ALEX.email },
    create: {
      email: ALEX.email,
      displayName: ALEX.displayName,
      passwordHash,
      isDemo: true,
    },
    update: {},
  });

  for (const contributor of [MARIA, ...OTHER_CONTRIBUTORS]) {
    await seedContributor(prisma, contributor, passwordHash, categories);
  }
  // Re-seeding applies the current SEED_DEMO_PASSWORD; accounts not created by this seeder are never touched.
  await prisma.user.updateMany({
    where: {
      isDemo: true,
      email: {
        in: [
          env.SEED_ADMIN_EMAIL,
          ALEX.email,
          ...[MARIA, ...OTHER_CONTRIBUTORS].map((item) => item.email),
        ],
      },
    },
    data: { passwordHash },
  });
  if (env.SEED_MARIA_PAYOUT_EMAIL) {
    await prisma.contributorProfile.updateMany({
      where: { user: { email: MARIA.email } },
      data: { payoutEmail: env.SEED_MARIA_PAYOUT_EMAIL },
    });
  }

  logger.log(
    `Seeded ${CATEGORIES.length} categories, admin, Alex and ${1 + OTHER_CONTRIBUTORS.length} demo contributors.`,
  );
  await prisma.$disconnect();
}

async function seedContributor(
  prisma: PrismaClient,
  contributor: DemoContributor,
  passwordHash: string,
  categories: Map<string, string>,
): Promise<void> {
  const user = await prisma.user.upsert({
    where: { email: contributor.email },
    create: {
      email: contributor.email,
      displayName: contributor.displayName,
      passwordHash,
      isDemo: true,
    },
    update: {},
  });
  const profile = await prisma.contributorProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      headline: contributor.headline,
      background: contributor.background,
      status: 'APPROVED',
      responsePriceCents: contributor.responsePriceCents,
      acceptingRequests: contributor.acceptingRequests,
      acceptanceWindowH: 48,
      deliveryH: 72,
    },
    update: {},
  });

  for (const guide of contributor.guides) {
    if (await prisma.guide.findUnique({ where: { slug: guide.slug } }))
      continue;
    const sections = GUIDE_SECTIONS.map((section) => ({
      ...section,
      body: guide.sections[section.key] ?? '',
    }));
    const created = await prisma.guide.create({
      data: {
        contributorId: profile.id,
        categoryId: categories.get(guide.category)!,
        slug: guide.slug,
        title: guide.title,
        priceCents: guide.priceCents,
        agentAssistAllowed: guide.agentAssistAllowed,
        topics: guide.topics,
        isDemo: true,
        status: 'PUBLISHED',
      },
    });
    const now = new Date();
    const version = await prisma.guideVersion.create({
      data: {
        guideId: created.id,
        number: 1,
        summary: guide.summary,
        preview: guide.preview,
        audience: guide.sections.audience ?? '',
        limitations: guide.sections.limitations ?? '',
        sections,
        reviewStatus: 'APPROVED',
        submittedAt: now,
        reviewedAt: now,
        publishedAt: now,
      },
    });
    await prisma.guide.update({
      where: { id: created.id },
      data: { currentVersionId: version.id },
    });
  }
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
