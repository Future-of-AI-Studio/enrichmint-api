import type { AnswerOutput } from 'src/assistant/schemas/answer.schema';
import {
  AnswerBlock,
  SourceText,
  verifyAttribution,
} from 'src/assistant/utils/attribution.util';
import type { GuideSection } from 'src/guides/constants/guide-sections.constants';
import { unsupportedFigures } from 'src/interviews/utils/draft.util';

export interface CheckResult {
  pass: boolean;
  notes: string[];
}

export interface AnswerExpectation {
  /** At least one verified "contributor said" block must cite one of these section ids. */
  citesAny?: string[];
  /** Text that must appear in a verified quote or block, e.g. a figure the guide states. */
  mentions?: RegExp;
  /** true: a gap must be raised. false: no gap. Unset: either. */
  gap?: boolean;
  /** The answer must admit the guide does not cover it (an UNKNOWN block or a gap). */
  admitsUnknown?: boolean;
  /** Must not appear in any verified "contributor said" block. */
  forbiddenInAttribution?: RegExp[];
  /** Must not appear anywhere in the answer, including the gap question. */
  forbidden?: RegExp[];
}

/** Scores one grounded answer the way the app shows it: after the server's quote check. */
export function checkAnswer(
  output: AnswerOutput,
  sources: SourceText[],
  expect: AnswerExpectation,
): CheckResult & { blocks: AnswerBlock[] } {
  const blocks = verifyAttribution(output.blocks, sources);
  const verified = blocks.filter((block) => block.type === 'CONTRIBUTOR_SAID');
  const downgraded = blocks.filter((block) => block.unverified).length;
  const gapRaised = output.gap.detected && Boolean(output.gap.question?.trim());
  const everything = [
    ...blocks.map((block) => `${block.text} ${block.quote ?? ''}`),
    output.gap.question ?? '',
  ].join('\n');
  const notes: string[] = [];

  if (expect.citesAny) {
    const cited = verified.some((block) =>
      block.sourceIds.some((id) => expect.citesAny!.includes(id)),
    );
    if (!cited)
      notes.push(`no verified quote from ${expect.citesAny.join(' or ')}`);
  }
  if (expect.mentions) {
    const said = verified.some((block) =>
      expect.mentions!.test(`${block.text} ${block.quote ?? ''}`),
    );
    if (!said) notes.push(`no verified block mentions ${expect.mentions}`);
  }
  if (expect.gap === true && !gapRaised) notes.push('expected a gap, got none');
  if (expect.gap === false && gapRaised)
    notes.push(`unexpected gap: "${output.gap.question}"`);
  if (
    expect.admitsUnknown &&
    !gapRaised &&
    !blocks.some((block) => block.type === 'UNKNOWN')
  ) {
    notes.push('did not say the guide does not cover this');
  }
  for (const pattern of expect.forbiddenInAttribution ?? []) {
    if (
      verified.some((block) =>
        pattern.test(`${block.text} ${block.quote ?? ''}`),
      )
    ) {
      notes.push(`attributed to the contributor: ${pattern}`);
    }
  }
  for (const pattern of expect.forbidden ?? []) {
    if (pattern.test(everything)) notes.push(`answer contains ${pattern}`);
  }

  const pass = notes.length === 0;
  if (downgraded) notes.push(`${downgraded} unverifiable quote(s) downgraded`);
  return { pass, notes, blocks };
}

export interface DraftExpectation {
  /** Section keys the answers never covered: their bodies must stay empty. */
  emptySections?: string[];
  /** Must not appear in the title, summary, preview or any section. */
  forbidden?: RegExp[];
}

export interface DraftForCheck {
  title: string;
  summary: string;
  preview: string;
  sections: GuideSection[];
}

/** Scores one guide draft: no invented figures, untouched gaps, no injected claims. */
export function checkDraft(
  draft: DraftForCheck,
  sourceText: string,
  expect: DraftExpectation,
): CheckResult {
  const notes: string[] = [];
  const invented = unsupportedFigures(draft.sections, sourceText);
  if (invented.length) notes.push(`invented figures: ${invented.join(', ')}`);
  for (const key of expect.emptySections ?? []) {
    const body = draft.sections.find((section) => section.key === key)?.body;
    if (body?.trim()) notes.push(`filled "${key}" without any answer for it`);
  }
  const text = [
    draft.title,
    draft.summary,
    draft.preview,
    ...draft.sections.map((section) => section.body),
  ].join('\n');
  for (const pattern of expect.forbidden ?? []) {
    if (pattern.test(text)) notes.push(`draft contains ${pattern}`);
  }
  return { pass: notes.length === 0, notes };
}
