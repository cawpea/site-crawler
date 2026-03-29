import * as cheerio from 'cheerio';
import { shouldSkipScheme, createUrlNormalizer } from './urlUtils.js';

export interface ParseResult {
  title: string | null;
  metaDescription: string | null;
  links: string[];
}

export function parseHtml(
  html: string,
  baseUrl: string,
  normalizeUrl: ReturnType<typeof createUrlNormalizer>
): ParseResult {
  try {
    const $ = cheerio.load(html);

    const title = $('title').first().text().trim() || null;

    const metaDescription =
      $('meta[name="description"]').attr('content')?.trim() ?? null;

    const rawLinks = new Set<string>();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      if (shouldSkipScheme(href)) return;
      const normalized = normalizeUrl(href, baseUrl);
      if (normalized) rawLinks.add(normalized);
    });

    return { title, metaDescription, links: Array.from(rawLinks) };
  } catch {
    return { title: null, metaDescription: null, links: [] };
  }
}
