export const STOP_WORDS = new Set(
  'the and for with that this have from your about what want know where start just they them their been were will would could should into than then also very much some more most only over such because while which there here when how why who our out not but are was had has can'.split(
    ' ',
  ),
);

const words = (text: string): Set<string> =>
  new Set(
    (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
      (word) => !STOP_WORDS.has(word),
    ),
  );

/** How many meaningful words two texts share; the fallback when AI matching is unavailable. */
export function keywordOverlap(a: string, b: string): number {
  const left = words(a);
  let count = 0;
  for (const word of words(b)) if (left.has(word)) count += 1;
  return count;
}
