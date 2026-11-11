import {
  buy,
  createTestApp,
  makeAdmin,
  makeContributorWithGuide,
  resetDatabase,
  signUp,
  TestContext,
} from './utils/test-app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Field notes and the enrichment share (e2e)', () => {
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

  async function publishNote(guideId: string) {
    const alex = await signUp(ctx, 'Alex');
    await buy(ctx, alex.token, { kind: 'GUIDE', guideId });
    // A note needs the learner's own account of trying it first.
    await ctx
      .http()
      .post('/api/field-notes/draft')
      .set(auth(alex.token))
      .send({ source: 'GUIDE', sourceId: guideId })
      .expect(409);
    await ctx
      .http()
      .post('/api/feedback')
      .set(auth(alex.token))
      .send({
        targetType: 'GUIDE',
        targetId: guideId,
        phase: 'FOLLOW_UP',
        tried: true,
        usefulAfter: true,
        outcome:
          'I used the pricing script on two clients and both accepted the new rate.',
      })
      .expect(201);
    const draft = await ctx
      .http()
      .post('/api/field-notes/draft')
      .set(auth(alex.token))
      .send({ source: 'GUIDE', sourceId: guideId })
      .expect(201);
    expect(draft.body.status).toBe('DRAFT');
    expect(draft.body.body).toContain('pricing script');

    await ctx
      .http()
      .post(`/api/field-notes/${draft.body.id}/publish`)
      .set(auth(alex.token))
      .send({ approved: false })
      .expect(400);
    const published = await ctx
      .http()
      .post(`/api/field-notes/${draft.body.id}/publish`)
      .set(auth(alex.token))
      .send({ approved: true, payoutEmail: 'alex-sandbox@test.local' })
      .expect(200);
    expect(published.body.status).toBe('PUBLISHED');
    return { alex, noteId: draft.body.id as string };
  }

  it('pays the note author 5% of a later sale from the platform commission, never from the author', async () => {
    const { guide, user: maria, profile } = await makeContributorWithGuide(ctx);
    const { alex } = await publishNote(guide.id);

    const alexProfile = await ctx.prisma.contributorProfile.findUniqueOrThrow({
      where: { userId: alex.id },
    });
    expect(alexProfile.status).toBe('EARNER');
    // An earner can be paid but cannot sell.
    await ctx.http().get('/api/interviews').set(auth(alex.token)).expect(403);

    const tomas = await signUp(ctx, 'Tomas');
    const { created } = await buy(ctx, tomas.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });
    const rows = await ctx.prisma.ledgerEntry.findMany({
      where: { orderId: created.orderId },
    });
    const sum = (account: string, contributorId?: string) =>
      rows
        .filter(
          (row) =>
            row.account === account &&
            (!contributorId || row.contributorId === contributorId),
        )
        .reduce((total, row) => total + row.amountCents, 0);
    expect(sum('CONTRIBUTOR_PAYABLE', profile.id)).toBe(425);
    expect(sum('CONTRIBUTOR_PAYABLE', alexProfile.id)).toBe(25);
    expect(sum('PLATFORM_COMMISSION')).toBe(50);

    const alexEarnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(alex.token))
      .expect(200);
    expect(alexEarnings.body.balances.earnedCents).toBe(25);
    const mariaEarnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(maria.token))
      .expect(200);
    // Alex's own purchase came before the note, so Maria has two full sales.
    expect(mariaEarnings.body.balances.earnedCents).toBe(850);

    const notes = await ctx
      .http()
      .get(`/api/guides/${guide.id}/field-notes`)
      .expect(200);
    expect(notes.body).toHaveLength(1);
    expect(notes.body[0].authorFirstName).toBe('Alex');
  });

  it('reverses the note share when the later sale is refunded', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const { alex } = await publishNote(guide.id);
    const admin = await makeAdmin(ctx);
    const tomas = await signUp(ctx, 'Tomas');
    const { created } = await buy(ctx, tomas.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });

    const refund = await ctx
      .http()
      .post('/api/refunds')
      .set(auth(tomas.token))
      .send({ orderId: created.orderId, reason: 'Not for me' })
      .expect(201);
    await ctx
      .http()
      .post(`/api/admin/refunds/${refund.body.id}/decision`)
      .set(auth(admin.token))
      .send({ approve: true })
      .expect(200);

    const earnings = await ctx
      .http()
      .get('/api/earnings/me')
      .set(auth(alex.token))
      .expect(200);
    expect(earnings.body.balances.earnedCents).toBe(0);
    const commission = await ctx.prisma.ledgerEntry.aggregate({
      _sum: { amountCents: true },
      where: { orderId: created.orderId, account: 'PLATFORM_COMMISSION' },
    });
    expect(commission._sum.amountCents).toBe(0);
  });

  it('does not pay a note author for sales made before the note was published', async () => {
    const { guide } = await makeContributorWithGuide(ctx);
    const tomas = await signUp(ctx, 'Tomas');
    const { created } = await buy(ctx, tomas.token, {
      kind: 'GUIDE',
      guideId: guide.id,
    });
    await publishNote(guide.id);
    expect(
      await ctx.prisma.ledgerEntry.count({
        where: { orderId: created.orderId, memo: 'Field note share' },
      }),
    ).toBe(0);
  });
});
