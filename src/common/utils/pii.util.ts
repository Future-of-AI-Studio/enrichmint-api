const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /\+?\d[\d\s().-]{6,18}\d/g;
const URL_WITH_QUERY = /https?:\/\/\S+\?\S+/gi;

/**
 * Removes emails, phone numbers and URLs with query strings before text goes to
 * an AI provider. Names cannot be removed reliably by pattern; the UI asks
 * people not to include them, and requests share only approved fields.
 */
export function scrubPii(text: string): string {
  return text
    .replace(EMAIL, '[email removed]')
    .replace(URL_WITH_QUERY, '[link removed]')
    .replace(PHONE, '[phone removed]');
}
