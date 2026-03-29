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

const NON_HTML_EXTENSIONS = new Set([
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.avif', '.tiff',
  // Documents
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods', '.odp',
  // Archives
  '.zip', '.tar', '.gz', '.bz2', '.rar', '.7z', '.dmg', '.pkg', '.apk', '.exe',
  // Media
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.wav', '.ogg', '.webm', '.m4a', '.m4v',
  // Fonts
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // Code / data (not HTML)
  '.js', '.css', '.json', '.xml', '.csv', '.txt', '.map',
]);

export function isNonHtmlUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    const dot = pathname.lastIndexOf('.');
    if (dot === -1) return false;
    return NON_HTML_EXTENSIONS.has(pathname.slice(dot));
  } catch {
    return false;
  }
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
