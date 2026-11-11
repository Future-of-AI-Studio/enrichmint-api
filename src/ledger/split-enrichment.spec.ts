import { splitEnrichment } from './ledger.service';

describe('splitEnrichment', () => {
  it('pays nothing when there are no field notes', () => {
    expect(splitEnrichment(500, 500, [])).toEqual([]);
  });

  it('gives one author the whole pool', () => {
    expect(splitEnrichment(500, 500, ['a'])).toEqual([
      { contributorId: 'a', cents: 25 },
    ]);
  });

  it('splits evenly and gives leftover cents to the earliest notes', () => {
    expect(splitEnrichment(500, 500, ['a', 'b'])).toEqual([
      { contributorId: 'a', cents: 13 },
      { contributorId: 'b', cents: 12 },
    ]);
  });

  it('counts each author once', () => {
    expect(splitEnrichment(1000, 500, ['a', 'a'])).toEqual([
      { contributorId: 'a', cents: 50 },
    ]);
  });

  it('never pays a zero share', () => {
    const shares = splitEnrichment(10, 500, ['a', 'b', 'c']);
    expect(shares.every((share) => share.cents > 0)).toBe(true);
    expect(shares.reduce((sum, share) => sum + share.cents, 0)).toBe(1);
  });
});
