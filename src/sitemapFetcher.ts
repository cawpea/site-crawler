import { request } from 'undici';
import * as cheerio from 'cheerio';
import type { CrawlerOptions } from './types.js';
import { createUrlNormalizer, isSameDomain } from './urlUtils.js';

const MAX_RECURSION_DEPTH = 3;

async function fetchXml(url: string, options: CrawlerOptions): Promise<string | null> {
  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headersTimeout: options.timeout,
      bodyTimeout: options.timeout,
      maxRedirections: 5,
      headers: { 'user-agent': 'site-crawler/1.0' },
      ...(options.ignoreSslErrors ? { connect: { rejectUnauthorized: false } } : {}),
    });
    if (statusCode !== 200) return null;
    return await body.text();
  } catch {
    return null;
  }
}

async function parseSitemap(
  url: string,
  options: CrawlerOptions,
  normalizeUrl: ReturnType<typeof createUrlNormalizer>,
  depth: number,
  visited: Set<string>,
): Promise<string[]> {
  if (depth > MAX_RECURSION_DEPTH) return [];
  if (visited.has(url)) return [];
  visited.add(url);

  const xml = await fetchXml(url, options);
  if (!xml) {
    process.stderr.write(`[sitemap] Failed to fetch: ${url}\n`);
    return [];
  }

  const $ = cheerio.load(xml, { xmlMode: true });
  const results: string[] = [];

  // サイトマップインデックス: 子サイトマップを再帰的に処理
  const sitemapLocs = $('sitemapindex > sitemap > loc');
  if (sitemapLocs.length > 0) {
    const childUrls = sitemapLocs.map((_, el) => $(el).text().trim()).get();
    for (const childUrl of childUrls) {
      const urls = await parseSitemap(childUrl, options, normalizeUrl, depth + 1, visited);
      results.push(...urls);
    }
    return results;
  }

  // URLセット: <url><loc> を収集
  $('urlset > url > loc').each((_, el) => {
    const raw = $(el).text().trim();
    const normalized = normalizeUrl(raw);
    if (!normalized) return;
    if (!isSameDomain(normalized, options.startUrl)) return;
    results.push(normalized);
  });

  return results;
}

export async function fetchSitemapUrls(options: CrawlerOptions): Promise<string[]> {
  const base = new URL(options.startUrl);
  const sitemapUrl = `${base.protocol}//${base.host}/sitemap.xml`;

  process.stderr.write(`[sitemap] Fetching: ${sitemapUrl}\n`);

  const normalizeUrl = createUrlNormalizer(options.ignoreQueryParams);
  const visited = new Set<string>();
  const urls = await parseSitemap(sitemapUrl, options, normalizeUrl, 0, visited);

  process.stderr.write(`[sitemap] Found ${urls.length} URLs\n`);
  return urls;
}
