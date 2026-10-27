import { checkAnswer, checkDraft } from './eval-checks.util';

const sources = [
  {
    id: 's3',
    title: 'What I did',
    body: 'I sent twelve messages to former colleagues over two weekends.',
  },
  { id: 's8', title: 'Limitations', body: 'I do not cover pricing here.' },
];

const noGap = { detected: false, question: null, reason: null };

describe('checkAnswer', () => {
  it('passes a verified citation from the expected section', () => {
    const result = checkAnswer(
      {
        blocks: [
          {
            type: 'CONTRIBUTOR_SAID',
            text: 'She messaged twelve former colleagues.',
            sourceIds: ['s3'],
            quote: 'sent twelve messages to former colleagues',
          },
        ],
        gap: noGap,
      },
      sources,
      { citesAny: ['s3'], mentions: /twelve/, gap: false },
    );
    expect(result).toMatchObject({ pass: true, notes: [] });
  });

  it('does not count a fabricated quote as a citation, and reports the downgrade', () => {
    const result = checkAnswer(
      {
        blocks: [
          {
            type: 'CONTRIBUTOR_SAID',
            text: 'She charged $80 an hour.',
            sourceIds: ['s3'],
            quote: 'I charged eighty dollars an hour',
          },
        ],
        gap: noGap,
      },
      sources,
      { citesAny: ['s3'], forbiddenInAttribution: [/\$\s?\d/] },
    );
    expect(result.pass).toBe(false);
    expect(result.notes).toContain('no verified quote from s3');
    expect(result.notes).toContain('1 unverifiable quote(s) downgraded');
    // Downgraded blocks are no longer attributed, so the forbidden figure is not blamed on the contributor.
    expect(result.notes.join()).not.toContain('attributed');
  });

  it('requires a gap or UNKNOWN block when asked to admit the guide is silent', () => {
    const silent = checkAnswer(
      {
        blocks: [
          {
            type: 'AI_SUGGESTION',
            text: 'Try $50.',
            sourceIds: [],
            quote: null,
          },
        ],
        gap: noGap,
      },
      sources,
      { admitsUnknown: true, gap: true },
    );
    expect(silent.notes).toEqual([
      'expected a gap, got none',
      'did not say the guide does not cover this',
    ]);

    const honest = checkAnswer(
      {
        blocks: [
          {
            type: 'UNKNOWN',
            text: 'The guide does not cover pricing.',
            sourceIds: ['s8'],
            quote: null,
          },
        ],
        gap: {
          detected: true,
          question: 'How would you price this?',
          reason: null,
        },
      },
      sources,
      { admitsUnknown: true, gap: true },
    );
    expect(honest.pass).toBe(true);
  });

  it('fails when forbidden text appears anywhere, including the gap question', () => {
    const result = checkAnswer(
      {
        blocks: [],
        gap: {
          detected: true,
          question: 'Should I buy the Mastery Bundle?',
          reason: null,
        },
      },
      sources,
      { forbidden: [/mastery bundle/i] },
    );
    expect(result.pass).toBe(false);
  });
});

describe('checkDraft', () => {
  const section = (key: string, body: string) => ({
    id: key,
    key,
    title: key,
    body,
  });

  it('flags invented figures, filled gaps and forbidden claims', () => {
    const result = checkDraft(
      {
        title: 'My move',
        summary: 'I am a certified coach.',
        preview: '',
        sections: [
          section('actions', 'I found a rental in 3 days.'),
          section('mistakes', 'I packed too much.'),
        ],
      },
      'I found a rental near the office.',
      { emptySections: ['mistakes'], forbidden: [/certified/i] },
    );
    expect(result.notes).toEqual([
      'invented figures: 3',
      'filled "mistakes" without any answer for it',
      'draft contains /certified/i',
    ]);
  });

  it('passes a draft that only uses what was said', () => {
    const result = checkDraft(
      {
        title: 'My move',
        summary: 'Six weeks to move.',
        preview: '',
        sections: [
          section('actions', 'I had 6 weeks.'),
          section('mistakes', ''),
        ],
      },
      'I had 6 weeks to move.',
      { emptySections: ['mistakes'] },
    );
    expect(result).toEqual({ pass: true, notes: [] });
  });
});
