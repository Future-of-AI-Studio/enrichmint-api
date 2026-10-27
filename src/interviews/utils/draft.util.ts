import { wrapUntrusted } from 'src/common/utils/prompt.util';
import {
  GUIDE_SECTIONS,
  GuideGapItem,
  GuideSection,
} from 'src/guides/constants/guide-sections.constants';
import type { DraftOutput } from '../schemas/interview-ai.schema';
import type { InterviewAnswer } from '../constants/interview.constants';

/** The guide-draft prompt input, shared with `yarn eval:agents`. Every answer is wrapped as untrusted data. */
export function buildDraftInput(
  background: string,
  answers: InterviewAnswer[],
): string {
  return [
    wrapUntrusted('contributor_background', background),
    ...answers.map((answer) =>
      wrapUntrusted(
        'contributor_answer',
        `Q: ${answer.question}\nA: ${answer.answer}${answer.followUp?.answer ? `\nFollow-up Q: ${answer.followUp.question}\nA: ${answer.followUp.answer}` : ''}`,
        { key: answer.key },
      ),
    ),
  ].join('\n\n');
}

function answerOf(answers: InterviewAnswer[], key: string): string {
  const item = answers.find((answer) => answer.key === key);
  if (!item) return '';
  const followUp = item.followUp?.answer ? `\n\n${item.followUp.answer}` : '';
  return `${item.answer}${followUp}`.trim();
}

/**
 * Deterministic draft used when AI is unavailable: the contributor's own
 * words, placed into the guide structure, with every empty section listed as a gap.
 */
export function verbatimDraft(answers: InterviewAnswer[], background: string) {
  const bodies: Record<string, string> = {
    background,
    starting_point: [
      answerOf(answers, 'situation'),
      answerOf(answers, 'starting_point'),
    ]
      .filter(Boolean)
      .join('\n\n'),
    actions: [answerOf(answers, 'actions'), answerOf(answers, 'reasoning')]
      .filter(Boolean)
      .join('\n\n'),
    mistakes: answerOf(answers, 'mistakes'),
    outcomes: answerOf(answers, 'outcome'),
    takeaways: answerOf(answers, 'differently'),
    audience: answerOf(answers, 'audience'),
    limitations: answerOf(answers, 'unsuitable'),
  };
  const sections = GUIDE_SECTIONS.map((section) => ({
    ...section,
    body: bodies[section.key] ?? '',
  }));
  const situation = answerOf(answers, 'situation');
  return {
    title: situation ? truncate(situation, 90) : 'My experience',
    summary: truncate(situation, 400),
    preview: truncate(
      [situation, answerOf(answers, 'audience')].filter(Boolean).join(' '),
      600,
    ),
    topics: [] as string[],
    sections,
    gaps: gapsFor(sections),
  };
}

/** Maps model output onto the fixed structure, and flags numbers the contributor never said. */
export function normalizeDraft(
  output: DraftOutput,
  answers: InterviewAnswer[],
  background: string,
) {
  const sourceText = `${answers.map((a) => `${a.answer} ${a.followUp?.answer ?? ''}`).join(' ')} ${background}`;
  const sections: GuideSection[] = GUIDE_SECTIONS.map((section) => ({
    ...section,
    body:
      output.sections.find((item) => item.key === section.key)?.body.trim() ??
      '',
  }));
  const gaps: GuideGapItem[] = [...output.gaps, ...gapsFor(sections)];
  for (const figure of unsupportedFigures(sections, sourceText)) {
    gaps.push({
      key: 'check_figure',
      question: `Please check "${figure}": it is in the draft but not in your answers. Remove it or confirm it.`,
    });
  }
  return {
    title: truncate(output.title, 120),
    summary: truncate(output.summary, 1000),
    preview: truncate(output.preview, 2000),
    topics: output.topics
      .map((topic) => topic.toLowerCase().trim())
      .filter(Boolean)
      .slice(0, 6),
    sections,
    gaps: dedupeGaps(gaps),
  };
}

function gapsFor(sections: GuideSection[]): GuideGapItem[] {
  return sections
    .filter((section) => !section.body.trim())
    .map((section) => ({
      key: section.key,
      question: `Nothing yet for "${section.title}". What would you add?`,
    }));
}

/** Numbers and money in the draft that do not appear anywhere in the source answers. */
export function unsupportedFigures(
  sections: GuideSection[],
  sourceText: string,
): string[] {
  const bare = (figure: string) => figure.replace(/[$,%]/g, '');
  const said = new Set(
    [...sourceText.matchAll(FIGURE)].map((match) => bare(match[0])),
  );
  const found = new Set<string>();
  for (const section of sections) {
    for (const match of section.body.matchAll(FIGURE)) {
      if (!said.has(bare(match[0]))) found.add(match[0]);
    }
  }
  return [...found];
}

const FIGURE = /\$?\d[\d,]*(\.\d+)?%?/g;

function dedupeGaps(gaps: GuideGapItem[]): GuideGapItem[] {
  const seen = new Set<string>();
  return gaps.filter((gap) => {
    const id = gap.question.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
