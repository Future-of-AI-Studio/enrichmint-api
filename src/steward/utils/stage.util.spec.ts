import type { RequestState } from 'generated/prisma/client';
import { deriveStage, diffUpdates, StewardSnapshot } from './stage.util';

const base = (): StewardSnapshot => ({
  goal: {
    id: 'g',
    text: 't',
    budgetCents: 2000,
    committedCents: 0,
    remainingCents: 2000,
  },
  hasAgentTurn: false,
  recommendationsShown: false,
  gapQuestion: null,
  activeGuide: null,
  activeRequest: null,
});

const guide = (owned: boolean) => ({
  id: 'guide1',
  slug: 's',
  title: 'Guide',
  priceCents: 500,
  owned,
  agentAssistAllowed: true,
  contributorName: 'Maria',
  questionsLeft: owned ? 10 : null,
});

const request = (
  state: RequestState,
  extra: Partial<NonNullable<StewardSnapshot['activeRequest']>> = {},
) => ({
  id: 'req1',
  state,
  priceCents: 1500,
  contributorName: 'Maria',
  acceptBy: null,
  payBy: '2026-10-21T10:00:00.000Z',
  deliverBy: '2026-10-24T10:00:00.000Z',
  hasResponse: false,
  responseAiAllowed: false,
  planCount: 0,
  ...extra,
});

describe('deriveStage', () => {
  it('walks the main path from facts only', () => {
    expect(deriveStage(base())).toBe('GOAL');
    expect(deriveStage({ ...base(), hasAgentTurn: true })).toBe(
      'FINDING_GUIDANCE',
    );
    expect(deriveStage({ ...base(), recommendationsShown: true })).toBe(
      'DECIDING_PURCHASE',
    );
    expect(deriveStage({ ...base(), activeGuide: guide(true) })).toBe(
      'USING_GUIDE',
    );
    expect(
      deriveStage({
        ...base(),
        activeGuide: guide(true),
        gapQuestion: 'Pricing?',
      }),
    ).toBe('GAP_FOUND');
  });

  it.each<[RequestState, string]>([
    ['DRAFT', 'REQUEST_DRAFT'],
    ['SENT', 'AWAITING_ACCEPTANCE'],
    ['ACCEPTED', 'AWAITING_PAYMENT'],
    ['PAID', 'AWAITING_DELIVERY'],
    ['OVERDUE', 'AWAITING_DELIVERY'],
    ['DECLINED', 'ENDED'],
    ['EXPIRED', 'ENDED'],
    ['PAYMENT_EXPIRED', 'ENDED'],
    ['CANCELLED', 'ENDED'],
    ['REFUNDED', 'ENDED'],
    ['RESOLVED_REFUNDED', 'ENDED'],
  ])('request %s maps to %s', (state, stage) => {
    expect(deriveStage({ ...base(), activeRequest: request(state) })).toBe(
      stage,
    );
  });

  it('asks to apply a delivered answer only when AI may use it, then finishes', () => {
    const delivered = (
      extra: Partial<NonNullable<StewardSnapshot['activeRequest']>>,
    ) =>
      deriveStage({
        ...base(),
        activeRequest: request('DELIVERED', { hasResponse: true, ...extra }),
      });
    expect(delivered({ responseAiAllowed: true })).toBe('APPLYING_RESPONSE');
    expect(delivered({ responseAiAllowed: true, planCount: 1 })).toBe('DONE');
    expect(delivered({ responseAiAllowed: false })).toBe('DONE');
  });
});

describe('diffUpdates', () => {
  it('reports a purchase once, and only for a guide seen unowned before', () => {
    const before = { guideId: 'guide1', guideOwned: false };
    const first = diffUpdates(before, { ...base(), activeGuide: guide(true) });
    expect(first.updates).toHaveLength(1);
    expect(first.updates[0].summary).toContain(
      'PayPal confirmed your purchase',
    );
    expect(
      diffUpdates(first.lastSeen, { ...base(), activeGuide: guide(true) })
        .updates,
    ).toHaveLength(0);
    // Switching to a guide that was already owned is not a new purchase.
    expect(
      diffUpdates({}, { ...base(), activeGuide: guide(true) }).updates,
    ).toHaveLength(0);
  });

  it('reports each request change once, with a payment card on acceptance', () => {
    const sent = diffUpdates(
      { requestId: 'req1', requestState: 'DRAFT' },
      { ...base(), activeRequest: request('SENT') },
    );
    expect(sent.updates[0].summary).toContain('Request sent to Maria');
    const accepted = diffUpdates(sent.lastSeen, {
      ...base(),
      activeRequest: request('ACCEPTED'),
    });
    expect(accepted.updates[0].card?.type).toBe('request_checkout');
    expect(accepted.updates[0].summary).toContain('$15.00');
    expect(
      diffUpdates(accepted.lastSeen, {
        ...base(),
        activeRequest: request('ACCEPTED'),
      }).updates,
    ).toHaveLength(0);
  });

  it('still announces the payment when delivery arrives before the next look', () => {
    const { updates } = diffUpdates(
      { requestId: 'req1', requestState: 'ACCEPTED' },
      { ...base(), activeRequest: request('DELIVERED') },
    );
    expect(updates.map((update) => update.summary)).toEqual([
      'PayPal confirmed your $15.00 payment.',
      expect.stringContaining('delivered a personal answer'),
    ]);
  });

  it('says plainly when nothing was charged', () => {
    for (const state of [
      'DECLINED',
      'EXPIRED',
      'PAYMENT_EXPIRED',
      'CANCELLED',
    ] as RequestState[]) {
      const { updates } = diffUpdates(
        { requestId: 'req1', requestState: 'SENT' },
        { ...base(), activeRequest: request(state) },
      );
      expect(updates[0].summary).toContain('not charged');
    }
  });

  it('does not announce a fresh draft (the draft card already does)', () => {
    expect(
      diffUpdates({}, { ...base(), activeRequest: request('DRAFT') }).updates,
    ).toHaveLength(0);
  });
});
