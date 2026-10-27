import { splitSale } from './ledger.service';

describe('splitSale (15% commission, platform pays the PayPal fee)', () => {
  it.each([
    [
      500,
      66,
      { commissionCents: 75, contributorCents: 425, platformNetCents: 9 },
    ],
    [
      1000,
      84,
      { commissionCents: 150, contributorCents: 850, platformNetCents: 66 },
    ],
    [
      1500,
      101,
      { commissionCents: 225, contributorCents: 1275, platformNetCents: 124 },
    ],
    [
      2000,
      119,
      { commissionCents: 300, contributorCents: 1700, platformNetCents: 181 },
    ],
  ])('%i cents with a %i cent fee', (gross, fee, expected) => {
    const split = splitSale(gross, 1500, fee);
    expect(split).toMatchObject(expected);
    expect(split.commissionCents + split.contributorCents).toBe(gross);
  });

  it('never changes the contributor share when the fee changes', () => {
    expect(splitSale(500, 1500, 0).contributorCents).toBe(
      splitSale(500, 1500, 300).contributorCents,
    );
  });
});
