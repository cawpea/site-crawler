import { getDomain } from 'tldts';

const SKIP_SCHEMES = new Set(['mailto:', 'tel:', 'javascript:', 'data:', 'ftp:', 'file:']);

export function shouldSkipScheme(href: string): boolean {
  const lower = href.trim().toLowerCase();
  if (lower.startsWith('#')) return true;
  for (const scheme of SKIP_SCHEMES) {
    if (lower.startsWith(scheme)) return true;
  }
  return false;
}

export function createUrlNormalizer(ignoreQueryParams: boolean) {
  return function normalizeUrl(url: string, base?: string): string | null {
    try {
      const parsed = new URL(url, base);

      // Only handle http/https
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }

      // Lowercase scheme and host (URL constructor already does this, but be explicit)
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase();

      // Remove fragment
      parsed.hash = '';

      // Remove default ports
      if (
        (parsed.protocol === 'http:' && parsed.port === '80') ||
        (parsed.protocol === 'https:' && parsed.port === '443')
      ) {
        parsed.port = '';
      }

      // Remove trailing slash (except for root path)
      if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }

      // Remove query params if requested
      if (ignoreQueryParams) {
        parsed.search = '';
      }

      return parsed.toString();
    } catch {
      return null;
    }
  };
}

export function getRegisteredDomain(hostname: string): string | null {
  return getDomain(hostname) ?? null;
}

export function isSameDomain(targetUrl: string, seedUrl: string): boolean {
  try {
    const targetHostname = new URL(targetUrl).hostname;
    const seedHostname = new URL(seedUrl).hostname;
    const targetDomain = getRegisteredDomain(targetHostname);
    const seedDomain = getRegisteredDomain(seedHostname);
    if (!targetDomain || !seedDomain) return false;
    return targetDomain === seedDomain;
  } catch {
    return false;
  }
}
