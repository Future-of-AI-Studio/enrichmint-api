import { RequestsJobs } from 'src/requests/requests.jobs';
import {
  buy,
  createTestApp,
  makeContributorWithGuide,
  makeGoal,
  resetDatabase,
  signUp,
  TestContext,
} from './utils/test-app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Personalized requests (e2e)', () => {
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

  async function sentRequest(goalBudget = 2000) {
    const maria = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    const goalId = await makeGoal(ctx, alex.token, goalBudget);
    const draft = await ctx
      .http()
      .post('/api/requests/draft-from-gap')
      .set(auth(alex.token))
      .send({
        guideId: maria.guide.id,
        question: 'How should I price onboarding for SaaS startups?',
        goalId,
      })
      .expect(201);
    await ctx
      .http()
      .patch(`/api/requests/${draft.body.id}`)
      .set(auth(alex.token))
      .send({
        contextItems: [
          {
            key: 'c1',
            label: 'Time available',
            value: 'Weekends only',
            share: true,
          },
          {
            key: 'c2',
            label: 'Current employer',
            value: 'Acme Support Ltd',
            share: false,
          },
        ],
      })
      .expect(200);
    await ctx
      .http()
      .post(`/api/requests/${draft.body.id}/send`)
      .set(auth(alex.token))
      .send({ approved: true })
      .expect(200);
    return { maria, alex, goalId, requestId: draft.body.id as string };
  }

  it('runs the full loop: send, accept, pay, deliver, with consent-limited context', async () => {
    const { maria, alex, goalId, requestId } = await sentRequest();

    const inbox = await ctx
      .http()
      .get(`/api/studio/requests/${requestId}`)
      .set(auth(maria.user.token))
      .expect(200);
    expect(inbox.body.sharedContext).toEqual([
      { label: 'Time available', value: 'Weekends only' },
    ]);
    expect(JSON.stringify(inbox.body)).not.toContain('Acme');
    expect(inbox.body.learnerFirstName).toBe('Alex');

    await ctx
      .http()
      .post(`/api/studio/requests/${requestId}/accept`)
      .set(auth(maria.user.token))
      .expect(200);
    const { captured } = await buy(ctx, alex.token, {
      kind: 'REQUEST',
      requestId,
      goalId,
    });
    expect(captured.status).toBe(200);

    const paid = await ctx.prisma.personalRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    expect(paid.state).toBe('PAID');
    // The delivery clock starts at payment confirmation.
    expect(paid.deliverBy!.getTime() - paid.paidAt!.getTime()).toBe(
      72 * 3_600_000,
    );

    await ctx
      .http()
      .post(`/api/studio/requests/${requestId}/deliver`)
      .set(auth(maria.user.token))
      .send({ body: 'I would charge a flat setup fee...', aiUseAllowed: true })
      .expect(200);
    const view = await ctx
      .http()
      .get(`/api/requests/${requestId}`)
      .set(auth(alex.token))
      .expect(200);
    expect(view.body.state).toBe('DELIVERED');
    expect(view.body.response.body).toContain('flat setup fee');

    const earnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(maria.user.token))
      .expect(200);
    expect(earnings.body.balances.earnedCents).toBe(1275);
    await ctx
      .http()
      .post('/api/feedback')
      .set(auth(alex.token))
      .send({
        targetType: 'RESPONSE',
        targetId: requestId,
        phase: 'IMMEDIATE',
        relevant: true,
        nextStep: true,
      })
      .expect(201);
  });

  it('reserves the request price against the budget, so a later purchase is blocked', async () => {
    const { alex, goalId } = await sentRequest(2000);
    const other = await makeContributorWithGuide(ctx, { priceCents: 600 });
    const blocked = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: other.guide.id, goalId, approved: true })
      .expect(409);
    expect(blocked.body.error).toBe('budget_exceeded');
  });

  it('refuses to send a request over budget', async () => {
    const maria = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    const goalId = await makeGoal(ctx, alex.token, 1000);
    const draft = await ctx
      .http()
      .post('/api/requests/draft-from-gap')
      .set(auth(alex.token))
      .send({ guideId: maria.guide.id, question: 'Pricing?', goalId })
      .expect(201);
    const sent = await ctx
      .http()
      .post(`/api/requests/${draft.body.id}/send`)
      .set(auth(alex.token))
      .send({ approved: true })
      .expect(409);
    expect(sent.body.error).toBe('budget_exceeded');
  });

  it('rejects transitions out of order or by the wrong person', async () => {
    const { maria, alex, requestId } = await sentRequest();
    const learnerAccept = await ctx
      .http()
      .post(`/api/studio/requests/${requestId}/accept`)
      .set(auth(alex.token))
      .expect(403);
    expect(learnerAccept.body.error).toBe('contributor_required');
    const early = await ctx
      .http()
      .post(`/api/studio/requests/${requestId}/deliver`)
      .set(auth(maria.user.token))
      .send({ body: 'x', aiUseAllowed: false })
      .expect(409);
    expect(early.body.error).toBe('invalid_request_state');
    await ctx
      .http()
      .post(`/api/studio/requests/${requestId}/accept`)
      .set(auth(maria.user.token))
      .expect(200);
    await ctx
      .http()
      .post(`/api/studio/requests/${requestId}/accept`)
      .set(auth(maria.user.token))
      .expect(409);

    const stranger = await makeContributorWithGuide(ctx);
    await ctx
      .http()
      .get(`/api/studio/requests/${requestId}`)
      .set(auth(stranger.user.token))
      .expect(404);
  });

  it('expires unanswered requests and lapsed payment windows', async () => {
    const jobs = ctx.app.get(RequestsJobs);
    const first = await sentRequest();
    await ctx.prisma.personalRequest.update({
      where: { id: first.requestId },
      data: { acceptBy: new Date(Date.now() - 1000) },
    });
    await jobs.runDeadlines();
    expect(
      (
        await ctx.prisma.personalRequest.findUniqueOrThrow({
          where: { id: first.requestId },
        })
      ).state,
    ).toBe('EXPIRED');
    await ctx
      .http()
      .post(`/api/studio/requests/${first.requestId}/accept`)
      .set(auth(first.maria.user.token))
      .expect(409);

    const second = await sentRequest();
    await ctx
      .http()
      .post(`/api/studio/requests/${second.requestId}/accept`)
      .set(auth(second.maria.user.token))
      .expect(200);
    const order = await ctx
      .http()
      .post('/api/orders')
      .set(auth(second.alex.token))
      .send({ kind: 'REQUEST', requestId: second.requestId, approved: true })
      .expect(201);
    await ctx.prisma.personalRequest.update({
      where: { id: second.requestId },
      data: { payBy: new Date(Date.now() - 1000) },
    });
    await jobs.runDeadlines();
    expect(
      (
        await ctx.prisma.personalRequest.findUniqueOrThrow({
          where: { id: second.requestId },
        })
      ).state,
    ).toBe('PAYMENT_EXPIRED');
    const late = await ctx
      .http()
      .post(`/api/orders/${order.body.orderId}/capture`)
      .set(auth(second.alex.token))
      .expect(409);
    expect(late.body.error).toBe('order_not_capturable');
    expect(ctx.paypal.calls.capture).toBe(0);
  });

  it('refunds a missed delivery automatically', async () => {
    const jobs = ctx.app.get(RequestsJobs);
    const { maria, alex, requestId } = await sentRequest();
    await ctx
      .http()
      .post(`/api/studio/requests/${requestId}/accept`)
      .set(auth(maria.user.token))
      .expect(200);
    const { created } = await buy(ctx, alex.token, {
      kind: 'REQUEST',
      requestId,
    });
    await ctx.prisma.personalRequest.update({
      where: { id: requestId },
      data: { deliverBy: new Date(Date.now() - 1000) },
    });
    await jobs.runDeadlines();
    expect(
      (
        await ctx.prisma.personalRequest.findUniqueOrThrow({
          where: { id: requestId },
        })
      ).state,
    ).toBe('OVERDUE');

    const refund = await ctx
      .http()
      .post('/api/refunds')
      .set(auth(alex.token))
      .send({ orderId: created.orderId, reason: 'Not delivered' })
      .expect(201);
    expect(refund.body.status).toBe('COMPLETED');
    expect(
      (
        await ctx.prisma.personalRequest.findUniqueOrThrow({
          where: { id: requestId },
        })
      ).state,
    ).toBe('REFUNDED');
    const earnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(maria.user.token))
      .expect(200);
    expect(earnings.body.balances.earnedCents).toBe(0);
  });
});
