import { z } from 'zod';

export const followUpSchema = z.object({
  followUp: z
    .string()
    .nullable()
    .describe(
      'One short, specific follow-up question, or null if the answer is clear enough.',
    ),
});

export const draftSchema = z.object({
  title: z
    .string()
    .describe(
      'Plain, specific title in the contributor voice. Max 90 characters.',
    ),
  summary: z
    .string()
    .describe('Two or three sentences on what this guide covers.'),
  preview: z
    .string()
    .describe(
      'A free preview a buyer can read before paying: what the guide covers, without giving away the steps.',
    ),
  topics: z
    .array(z.string())
    .describe('Three to six short lowercase topic tags.'),
  sections: z.array(
    z.object({
      key: z.enum([
        'background',
        'starting_point',
        'actions',
        'mistakes',
        'outcomes',
        'takeaways',
        'audience',
        'limitations',
      ]),
      body: z
        .string()
        .describe(
          'Written in first person from the contributor answers only. Empty string if the answers do not cover it.',
        ),
    }),
  ),
  gaps: z.array(
    z.object({
      key: z.string(),
      question: z
        .string()
        .describe('A question the contributor should answer to fill a gap.'),
    }),
  ),
});

export type DraftOutput = z.infer<typeof draftSchema>;
