import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from 'src/app.module';
import { configureApp } from 'src/app.setup';
import { GUIDE_SECTIONS } from 'src/guides/constants/guide-sections.constants';
import { OpenAiAdapter } from 'src/models/openai.adapter';
import { PaypalService } from 'src/paypal/paypal.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { FakeOpenAi } from './fake-openai';
import { FakePaypal } from './fake-paypal';

export interface TestContext {
  app: NestExpressApplication;
  prisma: PrismaService;
  paypal: FakePaypal;
  ai: FakeOpenAi;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const paypal = new FakePaypal();
  const ai = new FakeOpenAi();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PaypalService)
    .useValue(paypal)
    .overrideProvider(OpenAiAdapter)
    .useValue(ai)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: false,
  });
  configureApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, paypal, ai, http: () => request(app.getHttpServer()) };
}

/** Wipes every application table. Only ever runs against the test database (see setup-env.ts). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables
    .map((table) => `"public"."${table.tablename}"`)
    .join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE`);
}

let userCounter = 0;

export async function signUp(ctx: TestContext, name = 'Person') {
  userCounter += 1;
  const email = `${name.toLowerCase().replace(/\W/g, '')}${userCounter}-${Date.now()}@test.local`;
  const response = await ctx
    .http()
    .post('/api/auth/signup')
    .send({ displayName: name, email, password: 'correct-horse-battery' })
    .expect(201);
  return {
    id: response.body.user.id as string,
    token: response.body.accessToken as string,
    email,
  };
}

export async function makeAdmin(ctx: TestContext) {
  const admin = await signUp(ctx, 'Admin');
  await ctx.prisma.user.update({
    where: { id: admin.id },
    data: { role: 'ADMIN' },
  });
  return admin;
}

/** An approved contributor with one published guide. */
export async function makeContributorWithGuide(
  ctx: TestContext,
  options: {
    priceCents?: number;
    agentAssistAllowed?: boolean;
    responsePriceCents?: number | null;
  } = {},
) {
  const user = await signUp(ctx, 'Maria');
  const category = await ctx.prisma.category.upsert({
    where: { slug: 'work-transitions' },
    create: { slug: 'work-transitions', name: 'Work transitions' },
    update: {},
  });
  const profile = await ctx.prisma.contributorProfile.create({
    data: {
      userId: user.id,
      headline: 'Former support lead',
      background: 'Six years in support.',
      status: 'APPROVED',
      responsePriceCents:
        options.responsePriceCents === undefined
          ? 1500
          : options.responsePriceCents,
      acceptingRequests: options.responsePriceCents !== null,
      payoutEmail: 'maria-sandbox@test.local',
    },
  });
  const guide = await ctx.prisma.guide.create({
    data: {
      contributorId: profile.id,
      categoryId: category.id,
      slug: `guide-${Date.now()}-${userCounter}`,
      title: 'How I found my first freelance client',
      priceCents: options.priceCents ?? 500,
      agentAssistAllowed: options.agentAssistAllowed ?? true,
      status: 'PUBLISHED',
    },
  });
  const version = await ctx.prisma.guideVersion.create({
    data: {
      guideId: guide.id,
      number: 1,
      summary: 'Summary',
      preview: 'Free preview text',
      audience: 'Support workers',
      limitations: 'Needs a network',
      sections: GUIDE_SECTIONS.map((section) => ({
        ...section,
        body: `SECRET-BODY ${section.key}: I sent twelve messages to former colleagues over two weekends.`,
      })),
      reviewStatus: 'APPROVED',
      publishedAt: new Date(),
    },
  });
  await ctx.prisma.guide.update({
    where: { id: guide.id },
    data: { currentVersionId: version.id },
  });
  return { user, profile, guide: { ...guide, currentVersionId: version.id } };
}

export async function makeGoal(
  ctx: TestContext,
  token: string,
  budgetCents: number,
) {
  const response = await ctx
    .http()
    .post('/api/goals')
    .set('Authorization', `Bearer ${token}`)
    .send({ text: 'I want to explore freelancing on weekends.', budgetCents })
    .expect(201);
  return response.body.id as string;
}

/** Runs the two-step PayPal checkout the browser would do. */
export async function buy(
  ctx: TestContext,
  token: string,
  body: {
    kind: 'GUIDE' | 'REQUEST';
    guideId?: string;
    requestId?: string;
    goalId?: string;
  },
) {
  const created = await ctx
    .http()
    .post('/api/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({ ...body, approved: true })
    .expect(201);
  const captured = await ctx
    .http()
    .post(`/api/orders/${created.body.orderId}/capture`)
    .set('Authorization', `Bearer ${token}`);
  return { created: created.body, captured };
}
