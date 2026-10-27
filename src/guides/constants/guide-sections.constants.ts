/**
 * The domain-neutral guide structure. Section ids are stable across versions
 * so assistant citations ("Maria said, section 3") keep pointing at the same part.
 */
export const GUIDE_SECTIONS = [
  { id: 's1', key: 'background', title: 'About me' },
  { id: 's2', key: 'starting_point', title: 'Where I started' },
  { id: 's3', key: 'actions', title: 'What I did and why' },
  { id: 's4', key: 'mistakes', title: 'What went wrong and what I learned' },
  { id: 's5', key: 'outcomes', title: 'What happened (self-reported)' },
  { id: 's6', key: 'takeaways', title: 'Practical takeaways' },
  { id: 's7', key: 'audience', title: 'Who this is for' },
  { id: 's8', key: 'limitations', title: 'When this may not apply' },
] as const;

export type GuideSectionKey = (typeof GUIDE_SECTIONS)[number]['key'];

export interface GuideSection {
  id: string;
  key: string;
  title: string;
  body: string;
}

export interface GuideGapItem {
  key: string;
  question: string;
}

export function sectionsFrom(value: unknown): GuideSection[] {
  return Array.isArray(value) ? (value as GuideSection[]) : [];
}
