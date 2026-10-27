export type BlockType = 'CONTRIBUTOR_SAID' | 'AI_SUGGESTION' | 'UNKNOWN';

export interface AnswerBlock {
  type: BlockType;
  text: string;
  sourceIds: string[];
  quote: string | null;
  /** Set when the model claimed attribution the server could not verify. */
  unverified?: boolean;
}

export interface SourceText {
  id: string;
  title: string;
  body: string;
}

// Quote marks are dropped, so a quote wrapped in "..." or with '' for "" still matches the source.
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/['"‘’“”]/g, '')
    .replace(/[^a-z0-9$%.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const MIN_QUOTE_LENGTH = 12;
// Excerpt joins the model uses: "...", "…", a " / " between quotes, and "(s3)" id markers.
const FRAGMENT_BREAK = /\.{3,}|…|\s\/\s|\(s\d+\)/g;

/** A quote is supported when every excerpt in it appears verbatim in a cited source. */
function quoteSupported(quote: string, cited: string[]): boolean {
  const fragments = quote
    .split(FRAGMENT_BREAK)
    .map(normalize)
    .map((fragment) => fragment.replace(/^\.+|\.+$/g, '').trim())
    .filter(Boolean);
  return (
    fragments.some((fragment) => fragment.length >= MIN_QUOTE_LENGTH) &&
    fragments.every((fragment) => cited.some((body) => body.includes(fragment)))
  );
}

/**
 * Checks every "the contributor said" block against the real text: the cited
 * sources must exist and each excerpt of the quote must appear in one of them.
 * A block that fails is downgraded to an AI suggestion, so attribution is never invented.
 */
export function verifyAttribution(
  blocks: AnswerBlock[],
  sources: SourceText[],
): AnswerBlock[] {
  const byId = new Map(
    sources.map((source) => [source.id, normalize(source.body)]),
  );
  return blocks.map((block) => {
    const sourceIds = block.sourceIds.filter((id) => byId.has(id));
    if (block.type !== 'CONTRIBUTOR_SAID') return { ...block, sourceIds };

    const supported =
      Boolean(block.quote) &&
      quoteSupported(
        block.quote!,
        sourceIds.map((id) => byId.get(id)!),
      );
    if (supported) {
      // Wrapping quote marks are dropped; the UI adds its own.
      const quote = block.quote!.trim().replace(/^["“'‘]+|["”'’]+$/g, '');
      return { ...block, sourceIds, quote };
    }
    return {
      ...block,
      type: 'AI_SUGGESTION',
      sourceIds,
      quote: null,
      unverified: true,
    };
  });
}
