import { scrubPii } from 'src/common/utils/pii.util';
import { wrapUntrusted } from 'src/common/utils/prompt.util';

/** The grounded-answer prompt input. Shared by the assistant and `yarn eval:agents` so both test the same prompt. */
export function buildAnswerInput(parts: {
  guideTitle: string;
  contributorName: string;
  sourcesPrompt: string;
  situation?: string | null;
  history?: string;
  question: string;
}): string {
  return [
    `Guide: "${parts.guideTitle}" by ${parts.contributorName}`,
    parts.sourcesPrompt,
    parts.situation
      ? wrapUntrusted('learner_situation', scrubPii(parts.situation))
      : '',
    parts.history
      ? wrapUntrusted('earlier_conversation', scrubPii(parts.history))
      : '',
    wrapUntrusted('learner_question', scrubPii(parts.question)),
  ]
    .filter(Boolean)
    .join('\n\n');
}
