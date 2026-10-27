import { LocalPolicyAdapter } from './local-policy.adapter';

const base = {
  subjectRef: 'u1',
  action: 'purchase_guide' as const,
  amountCents: 500,
  remainingBudgetCents: 2000,
  approvedByUser: true,
  counterpartyAvailable: true,
  isOwnOffering: false,
};

describe('LocalPolicyAdapter.authorizeAction', () => {
  const policy = new LocalPolicyAdapter();

  it('allows an approved purchase within budget', async () => {
    expect((await policy.authorizeAction(base)).outcome).toBe('ALLOW');
  });

  it('allows spending exactly the remaining budget', async () => {
    expect(
      (await policy.authorizeAction({ ...base, amountCents: 2000 })).outcome,
    ).toBe('ALLOW');
  });

  it.each([
    [{ amountCents: 2001 }, 'exceed your budget'],
    [{ approvedByUser: false }, 'explicit approval'],
    [{ isOwnOffering: true }, 'your own'],
    [{ counterpartyAvailable: false }, 'not taking'],
  ])('denies %o', async (change, reason) => {
    const result = await policy.authorizeAction({ ...base, ...change });
    expect(result.outcome).toBe('DENY');
    expect(result.reasons.join(' ')).toContain(reason);
  });

  it('has no budget limit when the purchase is not tied to a goal', async () => {
    expect(
      (
        await policy.authorizeAction({
          ...base,
          amountCents: 99999,
          remainingBudgetCents: null,
        })
      ).outcome,
    ).toBe('ALLOW');
  });
});
