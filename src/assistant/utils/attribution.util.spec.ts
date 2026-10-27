import { verifyAttribution } from './attribution.util';

const sources = [
  {
    id: 's3',
    title: 'What I did',
    body: 'I sent twelve messages to former colleagues over two weekends.',
  },
  {
    id: 's8',
    title: 'Limitations',
    body: 'I do not cover pricing in detail here.',
  },
];

describe('verifyAttribution', () => {
  it('keeps a quote that really appears in the cited section', () => {
    const [block] = verifyAttribution(
      [
        {
          type: 'CONTRIBUTOR_SAID',
          text: 'Maria messaged her network.',
          sourceIds: ['s3'],
          quote: 'sent twelve messages to former colleagues',
        },
      ],
      sources,
    );
    expect(block.type).toBe('CONTRIBUTOR_SAID');
    expect(block.unverified).toBeUndefined();
  });

  it('downgrades a fabricated quote to an AI suggestion', () => {
    const [block] = verifyAttribution(
      [
        {
          type: 'CONTRIBUTOR_SAID',
          text: 'Maria charged $2,000.',
          sourceIds: ['s3'],
          quote: 'I charged two thousand dollars per project',
        },
      ],
      sources,
    );
    expect(block).toMatchObject({
      type: 'AI_SUGGESTION',
      quote: null,
      unverified: true,
    });
  });

  it('downgrades a real quote cited against the wrong section', () => {
    const [block] = verifyAttribution(
      [
        {
          type: 'CONTRIBUTOR_SAID',
          text: 'x',
          sourceIds: ['s8'],
          quote: 'sent twelve messages to former colleagues',
        },
      ],
      sources,
    );
    expect(block.type).toBe('AI_SUGGESTION');
  });

  it('drops citations to sections that do not exist', () => {
    const [block] = verifyAttribution(
      [
        {
          type: 'AI_SUGGESTION',
          text: 'Try your network.',
          sourceIds: ['s3', 's99'],
          quote: null,
        },
      ],
      sources,
    );
    expect(block.sourceIds).toEqual(['s3']);
  });

  it('accepts a real quote wrapped in quote marks and returns it unwrapped', () => {
    const [block] = verifyAttribution(
      [
        {
          type: 'CONTRIBUTOR_SAID',
          text: 'x',
          sourceIds: ['s3'],
          quote: '"I sent twelve messages to former colleagues."',
        },
      ],
      sources,
    );
    expect(block).toMatchObject({
      type: 'CONTRIBUTOR_SAID',
      quote: 'I sent twelve messages to former colleagues.',
    });
  });

  it('accepts excerpts joined with an ellipsis only when every excerpt is real', () => {
    const quote = (text: string) =>
      verifyAttribution(
        [
          {
            type: 'CONTRIBUTOR_SAID',
            text: 'x',
            sourceIds: ['s3'],
            quote: text,
          },
        ],
        sources,
      )[0].type;
    expect(quote('I sent twelve messages... over two weekends.')).toBe(
      'CONTRIBUTOR_SAID',
    );
    expect(quote('I sent twelve messages... and landed five clients.')).toBe(
      'AI_SUGGESTION',
    );
  });

  it('rejects a quote too short to mean anything', () => {
    const [block] = verifyAttribution(
      [
        {
          type: 'CONTRIBUTOR_SAID',
          text: 'x',
          sourceIds: ['s3'],
          quote: 'I sent',
        },
      ],
      sources,
    );
    expect(block.type).toBe('AI_SUGGESTION');
  });
});
