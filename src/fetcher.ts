import { Agent, fetch as undiciFetch } from 'undici';
import type { FetchResult, IFetcher, CrawlerOptions } from './types.js';

const USER_AGENT = 'site-crawler/1.0 (+https://github.com/cawpea/site-crawler)';
const MAX_RETRIES = 3;

function isRetryable(statusCode: number): boolean {
  return statusCode >= 500;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 10000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpFetcher implements IFetcher {
  private agent: Agent;

  constructor(private options: Pick<CrawlerOptions, 'timeout' | 'ignoreSslErrors'>) {
    this.agent = new Agent({
      connect: {
        timeout: options.timeout,
        rejectUnauthorized: !options.ignoreSslErrors,
      },
      bodyTimeout: options.timeout,
      headersTimeout: options.timeout,
    });
  }

  async fetch(url: string): Promise<FetchResult> {
    return this.fetchWithRetry(url, 0);
  }

  private async fetchWithRetry(url: string, attempt: number): Promise<FetchResult> {
    try {
      const signal = AbortSignal.timeout(this.options.timeout);

      const response = await undiciFetch(url, {
        dispatcher: this.agent,
        signal,
        redirect: 'follow',
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const finalUrl = response.url;
      const redirectedFrom = finalUrl !== url ? url : null;
      const statusCode = response.status;

      // Retry on 5xx
      if (isRetryable(statusCode) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        return this.fetchWithRetry(url, attempt + 1);
      }

      // Skip non-HTML content
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('text/html')) {
        await response.body?.cancel();
        return { url: finalUrl, redirectedFrom, statusCode, html: null, error: null };
      }

      const html = await response.text();
      return { url: finalUrl, redirectedFrom, statusCode, html, error: null };
    } catch (err: unknown) {
      // undici wraps errors as TypeError("fetch failed") with a cause — unwrap it
      const rootErr = (err instanceof Error && err.cause instanceof Error) ? err.cause : err;
      const error = rootErr instanceof Error ? rootErr.message : String(rootErr);

      // In the catch block we only land on network/TLS/timeout errors (not 4xx/5xx).
      // Always retry up to MAX_RETRIES.
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        return this.fetchWithRetry(url, attempt + 1);
      }

      return { url, redirectedFrom: null, statusCode: 0, html: null, error };
    }
  }

  async destroy(): Promise<void> {
    await this.agent.destroy();
  }
}
