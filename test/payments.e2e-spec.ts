import { PaypalError } from 'src/paypal/paypal.service';
import {
  buy,
  createTestApp,
  makeAdmin,
  makeContributorWithGuide,
  makeGoal,
  resetDatabase,
  signUp,
  TestContext,
} from './utils/test-app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function webhook(
  ctx: TestContext,
  id: string,
  type: string,
  resource: unknown,
) {
  return ctx
    .http()
    .post('/api/webhooks/paypal')
    .set({
      'paypal-transmission-id': `t-${id}`,
      'paypal-transmission-time': new Date().toISOString(),
      'paypal-transmission-sig': 'sig',
      'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
      'paypal-auth-algo': 'SHA256withRSA',
    })
    .send({ id, event_type: type, resource });
}

describe('Payments (e2e)', () => {
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

  it('grants access only after a confirmed capture, with the commission split in the ledger', async () => {
    const { guide, profile } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');

    const created = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: guide.id, approved: true })
      .expect(201);
    expect(created.body.amountCents).toBe(500);
    // Approved at PayPal but not captured yet: still no access.
    await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(alex.token))
      .expect(403);

    const captured = await ctx
      .http()
      .post(`/api/orders/${created.body.orderId}/capture`)
      .set(auth(alex.token))
      .expect(200);
    expect(captured.body.status).toBe('COMPLETED');
    const content = await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(alex.token))
      .expect(200);
    expect(JSON.stringify(content.body)).toContain('SECRET-BODY');

    const entries = await ctx.prisma.ledgerEntry.findMany({
      where: { orderId: created.body.orderId },
    });
    const byAccount = Object.fromEntries(
      entries.map((entry) => [entry.account, entry.amountCents]),
    );
    expect(byAccount).toEqual({
      GROSS_SALES: 500,
      PLATFORM_COMMISSION: 75,
      CONTRIBUTOR_PAYABLE: 425,
      PROCESSING_FEE: -66,
    });
    expect(entries.every((entry) => entry.contributorId === profile.id)).toBe(
      true,
    );
  });

  it('rejects a client-supplied amount and an unapproved purchase', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({
        kind: 'GUIDE',
        guideId: guide.id,
        approved: true,
        amountCents: 1,
      })
      .expect(400);
    const unapproved = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: guide.id, approved: false })
      .expect(409);
    expect(unapproved.body.error).toBe('policy_denied');
    expect(ctx.paypal.calls.create).toBe(0);
  });

  it('checks approval and budget even when an open order could be reused', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: guide.id, approved: true })
      .expect(201);
    const unapproved = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: guide.id, approved: false })
      .expect(409);
    expect(unapproved.body.error).toBe('policy_denied');

    const goal = await ctx.prisma.learnerGoal.create({
      data: { userId: alex.id, text: 'Tight budget', budgetCents: 100 },
    });
    const overBudget = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({
        kind: 'GUIDE',
        guideId: guide.id,
        goalId: goal.id,
        approved: true,
      })
      .expect(409);
    expect(overBudget.body.error).toBe('budget_exceeded');
    expect(ctx.paypal.calls.create).toBe(1);
  });

  it('is idempotent across a repeated capture call and replayed webhooks', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    const { created } = await buy(ctx, alex.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });

    await ctx
      .http()
      .post(`/api/orders/${created.orderId}/capture`)
      .set(auth(alex.token))
      .expect(200);
    const resource = ctx.paypal.captureResource(created.paypalOrderId);
    await webhook(ctx, 'WH-1', 'PAYMENT.CAPTURE.COMPLETED', resource).expect(
      200,
    );
    const replay = await webhook(
      ctx,
      'WH-1',
      'PAYMENT.CAPTURE.COMPLETED',
      resource,
    ).expect(200);
    expect(replay.body.duplicate).toBe(true);
    await webhook(ctx, 'WH-2', 'PAYMENT.CAPTURE.COMPLETED', resource).expect(
      200,
    );

    expect(await ctx.prisma.entitlement.count()).toBe(1);
    expect(
      await ctx.prisma.ledgerEntry.count({
        where: { orderId: created.orderId },
      }),
    ).toBe(4);
    expect(ctx.paypal.calls.capture).toBe(1);
  });

  it('fulfils from the webhook when it arrives before the capture response', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    const created = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: guide.id, approved: true })
      .expect(201);

    await webhook(
      ctx,
      'WH-early',
      'PAYMENT.CAPTURE.COMPLETED',
      ctx.paypal.captureResource(created.body.paypalOrderId),
    ).expect(200);
    await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(alex.token))
      .expect(200);
    const late = await ctx
      .http()
      .post(`/api/orders/${created.body.orderId}/capture`)
      .set(auth(alex.token))
      .expect(200);
    expect(late.body.status).toBe('COMPLETED');
    expect(await ctx.prisma.ledgerEntry.count()).toBe(4);
  });

  it('withholds access while a capture is PENDING and grants it when PayPal completes it', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    ctx.paypal.captureStatus = 'PENDING';
    const { created, captured } = await buy(ctx, alex.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });
    expect(captured.body.status).toBe('CAPTURE_PENDING');
    await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(alex.token))
      .expect(403);

    await webhook(
      ctx,
      'WH-done',
      'PAYMENT.CAPTURE.COMPLETED',
      ctx.paypal.captureResource(created.paypalOrderId),
    ).expect(200);
    await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(alex.token))
      .expect(200);
  });

  it('grants nothing when the card is declined', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    ctx.paypal.captureError = new PaypalError(
      422,
      'INSTRUMENT_DECLINED',
      'debug',
    );
    const { captured } = await buy(ctx, alex.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });
    expect(captured.status).toBe(409);
    expect(captured.body.error).toBe('capture_denied');
    expect(await ctx.prisma.entitlement.count()).toBe(0);
    expect(await ctx.prisma.ledgerEntry.count()).toBe(0);
  });

  it('refuses to fulfil when the captured amount does not match the order', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    ctx.paypal.captureValueOverride = '0.01';
    const { created } = await buy(ctx, alex.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: created.orderId },
    });
    expect(order.status).toBe('FAILED');
    expect(order.failureReason).toBe('amount_mismatch_needs_refund');
    expect(await ctx.prisma.entitlement.count()).toBe(0);
  });

  it('ignores webhooks whose signature PayPal does not verify', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    const created = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: guide.id, approved: true })
      .expect(201);
    ctx.paypal.webhookVerified = false;
    await webhook(
      ctx,
      'WH-forged',
      'PAYMENT.CAPTURE.COMPLETED',
      ctx.paypal.captureResource(created.body.paypalOrderId),
    ).expect(400);
    expect(await ctx.prisma.entitlement.count()).toBe(0);
    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: created.body.orderId },
    });
    expect(order.status).toBe('CREATED');
  });

  it('blocks a purchase that would exceed the goal budget, before charging', async () => {
    const first = await makeContributorWithGuide(ctx, { priceCents: 500 });
    const second = await makeContributorWithGuide(ctx, { priceCents: 600 });
    const alex = await signUp(ctx, 'Alex');
    const goalId = await makeGoal(ctx, alex.token, 1000);

    await buy(ctx, alex.token, {
      kind: 'GUIDE',
      guideId: first.guide.id,
      goalId,
    });
    const blocked = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: second.guide.id, goalId, approved: true })
      .expect(409);
    expect(blocked.body.error).toBe('budget_exceeded');
    expect(blocked.body.remainingBudgetCents).toBe(500);
    const log = await ctx
      .http()
      .get('/api/stewardship-log')
      .set(auth(alex.token))
      .expect(200);
    expect(log.body[0].outcome).toBe('DENY');
  });

  it('lets only one of two parallel captures through when together they exceed the budget', async () => {
    const first = await makeContributorWithGuide(ctx, { priceCents: 600 });
    const second = await makeContributorWithGuide(ctx, { priceCents: 600 });
    const alex = await signUp(ctx, 'Alex');
    const goalId = await makeGoal(ctx, alex.token, 1000);

    const a = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: first.guide.id, goalId, approved: true })
      .expect(201);
    const b = await ctx
      .http()
      .post('/api/orders')
      .set(auth(alex.token))
      .send({ kind: 'GUIDE', guideId: second.guide.id, goalId, approved: true })
      .expect(201);
    const results = await Promise.all([
      ctx
        .http()
        .post(`/api/orders/${a.body.orderId}/capture`)
        .set(auth(alex.token)),
      ctx
        .http()
        .post(`/api/orders/${b.body.orderId}/capture`)
        .set(auth(alex.token)),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await ctx.prisma.entitlement.count()).toBe(1);
    expect(ctx.paypal.calls.capture).toBe(1);
  });

  it('refunds through PayPal, reverses the ledger and revokes access', async () => {
    const { guide, user: maria } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    const admin = await makeAdmin(ctx);
    const { created } = await buy(ctx, alex.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });

    const refund = await ctx
      .http()
      .post('/api/refunds')
      .set(auth(alex.token))
      .send({ orderId: created.orderId, reason: 'Not what I expected' })
      .expect(201);
    expect(refund.body.status).toBe('REQUESTED');
    await ctx
      .http()
      .post(`/api/admin/refunds/${refund.body.id}/decision`)
      .set(auth(admin.token))
      .send({ approve: true })
      .expect(200);

    const order = await ctx.prisma.order.findUniqueOrThrow({
      where: { id: created.orderId },
    });
    expect(order.status).toBe('REFUNDED');
    await ctx
      .http()
      .get(`/api/guides/${guide.id}/content`)
      .set(auth(alex.token))
      .expect(403);
    const earnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(maria.token))
      .expect(200);
    expect(earnings.body.balances.earnedCents).toBe(0);
    expect(earnings.body.balances.transferredCents).toBe(0);

    // The refund webhook arriving afterwards changes nothing.
    await webhook(ctx, 'WH-refund', 'PAYMENT.CAPTURE.REFUNDED', {
      id: `REF-${order.paypalCaptureId}`,
      status: 'COMPLETED',
      links: [
        {
          rel: 'up',
          href: `https://x/v2/payments/captures/${order.paypalCaptureId}`,
        },
      ],
    }).expect(200);
    expect(
      await ctx.prisma.ledgerEntry.count({ where: { account: 'REFUNDS' } }),
    ).toBe(1);
  });

  it('keeps earned, available and transferred apart through a payout', async () => {
    const { guide, user: maria } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    await buy(ctx, alex.token, { kind: 'GUIDE', guideId: guide.id });

    const payout = await ctx
      .http()
      .post('/api/payouts')
      .set(auth(maria.token))
      .expect(201);
    expect(payout.body.status).toBe('PENDING');
    let earnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(maria.token))
      .expect(200);
    expect(earnings.body.balances).toMatchObject({
      earnedCents: 425,
      availableCents: 0,
      payoutPendingCents: 425,
      transferredCents: 0,
    });

    await webhook(ctx, 'WH-payout', 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', {
      payout_item_id: 'ITEM-1',
      payout_batch_id: payout.body.paypalBatchId,
      transaction_status: 'SUCCESS',
    }).expect(200);
    earnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(maria.token))
      .expect(200);
    expect(earnings.body.balances).toMatchObject({
      payoutPendingCents: 0,
      transferredCents: 425,
    });
  });

  it('returns the money to the balance when PayPal Payouts is not enabled', async () => {
    const { guide, user: maria } = await makeContributorWithGuide(ctx);
    const alex = await signUp(ctx, 'Alex');
    await buy(ctx, alex.token, { kind: 'GUIDE', guideId: guide.id });
    ctx.paypal.payoutError = new PaypalError(
      403,
      'AUTHORIZATION_ERROR',
      'debug',
    );

    const payout = await ctx
      .http()
      .post('/api/payouts')
      .set(auth(maria.token))
      .expect(201);
    expect(payout.body).toMatchObject({
      status: 'FAILED',
      failureReason: 'payouts_not_enabled',
    });
    const earnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(maria.token))
      .expect(200);
    expect(earnings.body.balances).toMatchObject({
      availableCents: 425,
      transferredCents: 0,
    });
  });
});
