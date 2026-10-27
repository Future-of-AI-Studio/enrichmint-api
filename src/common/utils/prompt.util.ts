/**
 * Wraps untrusted text (contributor content, learner messages) in a tag.
 * Closing-tag sequences inside the text are broken up so the text cannot end
 * its own tag and smuggle instructions after it.
 */
export function wrapUntrusted(
  tag: string,
  text: string,
  attributes: Record<string, string> = {},
): string {
  const safe = text.replace(/<\s*\//g, '< /');
  const attrs = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${value.replace(/["<>]/g, '')}"`)
    .join('');
  return `<${tag}${attrs}>\n${safe}\n</${tag}>`;
}
