import type { IFetcher, FetchResult, CrawlerOptions } from './types.js';

const USER_AGENT = 'site-crawler/1.0 (+https://github.com/cawpea/site-crawler)';
// Playwright pages are heavy; cap at 5 concurrent even if --concurrency is higher
const MAX_CONCURRENT_PAGES = 5;

export class PlaywrightFetcher implements IFetcher {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private browser: any = null;
  private activePages = 0;
  private timeout: number;

  constructor(options: Pick<CrawlerOptions, 'timeout'>) {
    this.timeout = options.timeout;
  }

  async init(): Promise<void> {
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new Error(
        'Playwright is not installed. Run: npm install playwright && npx playwright install chromium'
      );
    }
    this.browser = await chromium.launch({ headless: true });
  }

  async fetch(url: string): Promise<FetchResult> {
    if (!this.browser) {
      throw new Error('PlaywrightFetcher not initialized. Call init() first.');
    }

    // Wait if too many pages are open
    while (this.activePages >= MAX_CONCURRENT_PAGES) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    this.activePages++;
    const context = await this.browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    try {
      let statusCode = 0;
      let redirectedFrom: string | null = null;

      const response = await page.goto(url, {
        timeout: this.timeout,
        waitUntil: 'networkidle',
      });

      if (response) {
        statusCode = response.status();
        const finalUrl = response.url();
        if (finalUrl !== url) {
          redirectedFrom = url;
        }
      }

      const finalUrl = page.url();
      const html = await page.content();

      return {
        url: finalUrl,
        redirectedFrom,
        statusCode,
        html,
        error: null,
      };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      return { url, redirectedFrom: null, statusCode: 0, html: null, error };
    } finally {
      await page.close();
      await context.close();
      this.activePages--;
    }
  }

  async destroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
