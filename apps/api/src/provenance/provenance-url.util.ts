/**
 * Strict external URL sanitization helper.
 * Only permits valid http:// and https:// URLs.
 * Disallows javascript:, data:, file:, and other unsafe URI schemes.
 */
export function sanitizeProvenanceUrl(url?: string | null): string | undefined {
  if (!url || typeof url !== "string") {
    return undefined;
  }
  const trimmed = url.trim();
  if (/^https?:\/\/[^\s$.?#].[^\s]*$/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}
