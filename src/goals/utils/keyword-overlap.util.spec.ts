import { keywordOverlap } from './keyword-overlap.util';

describe('keywordOverlap', () => {
  it('counts shared meaningful words once each', () => {
    expect(
      keywordOverlap(
        'Moving abroad to Portugal with kids',
        'I moved my family abroad to Portugal; kids, schools, visas',
      ),
    ).toBe(3);
  });

  it('ignores stop words and short words', () => {
    expect(keywordOverlap('how to do it', 'how to do it')).toBe(0);
  });

  it('is zero for unrelated text', () => {
    expect(keywordOverlap('press release launch', 'caregiving at home')).toBe(
      0,
    );
  });
});
