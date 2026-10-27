import {
  buy,
  createTestApp,
  makeContributorWithGuide,
  resetDatabase,
  signUp,
  TestContext,
} from './utils/test-app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Access control and consent (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.prisma);
    ctx.paypal.reset();
  });
  afterAll(async () => {
    await ctx.app.close();
  });

  it('never exposes section bodies on public or discovery routes', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    const list = await ctx.http().get('/api/guides').expect(200);
    const one = await ctx
      .http()
      .get(`/api/guides/by-slug/${guide.slug}`)
      .expect(200);
    const goal = await ctx
      .http()
      .post('/api/goals')
      .set(auth(alex.token))
      .send({ text: 'freelance first client support', budgetCents: 2000 })
      .expect(201);
    const recs = await ctx
      .http()
      .post(`/api/goals/${goal.body.id}/recommendations`)
      .set(auth(alex.token))
      .expect(201);

    for (const body of [list.body, one.body, recs.body]) {
      expect(JSON.stringify(body)).not.toContain('SECRET-BODY');
    }
    expect(
      recs.body.recommendations[0].guide.currentVersion.outline,
    ).toHaveLength(8);
  });

  it('requires a purchase for content and the assistant', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const stranger = await signUp(ctx, 'Stranger');
    const content = await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(stranger.token))
      .expect(403);
    expect(content.body.error).toBe('not_entitled');
    const ask = await ctx
      .http()
      .post(`/api/assistant/guides/${guide.id}/questions`)
      .set(auth(stranger.token))
      .send({ question: 'Summarize it' })
      .expect(403);
    expect(ask.body.error).toBe('not_entitled');
    await ctx.http().get(`/api/guides/${guide.id}/content`).expect(401);
  });

  it('keeps AI away from a guide whose contributor prohibits it, while the buyer can still read it', async () => {
    const { guide } = await makeContributorWithGuide(ctx, {
      agentAssistAllowed: false,
    });
    const alex = await signUp(ctx, 'Alex');
    await buy(ctx, alex.token, { kind: 'GUIDE', guideId: guide.id });

    await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(alex.token))
      .expect(200);
    const ask = await ctx
      .http()
      .post(`/api/assistant/guides/${guide.id}/questions`)
      .set(auth(alex.token))
      .send({ question: 'Summarize it' })
      .expect(403);
    expect(ask.body.error).toBe('agent_access_not_permitted');
    const entitlement = await ctx.prisma.entitlement.findFirstOrThrow({
      where: { guideId: guide.id },
    });
    expect(entitlement.aiQuestionsUsed).toBe(0);
    const log = await ctx
      .http()
      .get('/api/stewardship-log')
      .set(auth(alex.token))
      .expect(200);
    expect(
      log.body.some(
        (entry: { check: string }) => entry.check === 'agent_access',
      ),
    ).toBe(true);
  });

  it('applies a withdrawn AI permission to existing buyers immediately', async () => {
    const { guide, user: maria } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    await buy(ctx, alex.token, { kind: 'GUIDE', guideId: guide.id });
    await ctx
      .http()
      .patch(`/api/studio/guides/${guide.id}/settings`)
      .set(auth(maria.token))
      .send({ agentAssistAllowed: false })
      .expect(200);

    const ask = await ctx
      .http()
      .post(`/api/assistant/guides/${guide.id}/questions`)
      .set(auth(alex.token))
      .send({ question: 'Help me' })
      .expect(403);
    expect(ask.body.error).toBe('agent_access_not_permitted');
    const history = await ctx.prisma.guidePermissionChange.findMany({
      where: { guideId: guide.id },
    });
    expect(history[0]).toMatchObject({
      field: 'agent_assist_allowed',
      oldValue: 'true',
      newValue: 'false',
    });
  });

  it('stops a contributor from buying their own guide and from editing someone else’s', async () => {
    const first = await makeContributorWithGuide(ctx);
    const second = await makeContributorWithGuide(ctx);
    const own = await ctx
      .http()
      .post('/api/orders')
      .set(auth(first.user.token))
      .send({ kind: 'GUIDE', guideId: first.guide.id, approved: true })
      .expect(409);
    expect(own.body.error).toBe('policy_denied');
    await ctx
      .http()
      .patch(`/api/studio/guides/${second.guide.id}/settings`)
      .set(auth(first.user.token))
      .send({ priceCents: 900 })
      .expect(404);
  });

  it('only lets recipients leave feedback', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const stranger = await signUp(ctx, 'Stranger');
    const denied = await ctx
      .http()
      .post('/api/feedback')
      .set(auth(stranger.token))
      .send({
        targetType: 'GUIDE',
        targetId: guide.id,
        phase: 'IMMEDIATE',
        relevant: true,
      })
      .expect(403);
    expect(denied.body.error).toBe('feedback_not_allowed');
  });

  it('keeps admin routes for admins', async () => {
    const alex = await signUp(ctx, 'Alex');
    const denied = await ctx
      .http()
      .get('/api/admin/overview')
      .set(auth(alex.token))
      .expect(403);
    expect(denied.body.error).toBe('role_required');
  });
});
