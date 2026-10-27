import { z } from 'zod';

export const answerSchema = z.object({
  blocks: z
    .array(
      z.object({
        type: z
          .enum(['CONTRIBUTOR_SAID', 'AI_SUGGESTION', 'UNKNOWN'])
          .describe(
            'CONTRIBUTOR_SAID: what the contributor actually wrote. AI_SUGGESTION: your inference or a next step for this learner. UNKNOWN: something the sources do not answer.',
          ),
        text: z.string(),
        sourceIds: z
          .array(z.string())
          .describe('Ids of the sources this block relies on, e.g. ["s3"].'),
        quote: z
          .string()
          .nullable()
          .describe(
            'For CONTRIBUTOR_SAID only: one continuous passage of at least a few words, copied exactly from one cited source, without added quotation marks or ellipses. Use a separate block for another passage. Otherwise null.',
          ),
      }),
    )
    .describe('The answer, in order. Keep it short and practical.'),
  gap: z.object({
    detected: z
      .boolean()
      .describe(
        'True when the question needs firsthand judgment the sources do not contain.',
      ),
    question: z
      .string()
      .nullable()
      .describe(
        'If detected: the specific question the contributor could answer personally, phrased for them.',
      ),
    reason: z
      .string()
      .nullable()
      .describe('If detected: one sentence on what is missing.'),
  }),
});

export type AnswerOutput = z.infer<typeof answerSchema>;
