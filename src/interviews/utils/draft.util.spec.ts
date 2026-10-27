import {
  normalizeDraft,
  unsupportedFigures,
  verbatimDraft,
} from './draft.util';

const answers = [
  {
    key: 'situation',
    question: 'q',
    answer: 'My support team was reorganized.',
  },
  { key: 'actions', question: 'q', answer: 'I messaged 12 former colleagues.' },
];

describe('guide drafting', () => {
  it('flags figures the contributor never said', () => {
    const sections = [
      {
        id: 's3',
        key: 'actions',
        title: 't',
        body: 'I messaged 12 colleagues and earned $3,000 in 2 months.',
      },
    ];
    expect(
      unsupportedFigures(sections, 'I messaged 12 former colleagues.'),
    ).toEqual(['$3,000', '2']);
  });

  it('turns an invented figure into a gap question instead of keeping it silently', () => {
    const draft = normalizeDraft(
      {
        title: 'T',
        summary: 'S',
        preview: 'P',
        topics: ['Freelancing'],
        sections: [{ key: 'outcomes', body: 'I doubled my income to $5000.' }],
        gaps: [],
      },
      answers,
      'Six years in support.',
    );
    expect(draft.gaps.some((gap) => gap.question.includes('$5000'))).toBe(true);
    expect(draft.topics).toEqual(['freelancing']);
  });

  it('without AI keeps the contributor words verbatim and lists empty sections as gaps', () => {
    const draft = verbatimDraft(answers, 'Six years in support.');
    expect(
      draft.sections.find((section) => section.key === 'actions')!.body,
    ).toBe('I messaged 12 former colleagues.');
    expect(draft.gaps.map((gap) => gap.key)).toContain('mistakes');
  });
});
