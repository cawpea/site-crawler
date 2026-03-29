#!/usr/bin/env node
import { Command } from 'commander';
import { Crawler } from './crawler.js';
import { HttpFetcher } from './fetcher.js';
import type { CrawlerOptions, IFetcher } from './types.js';

const program = new Command();

program
  .name('crawl')
  .description('Recursively crawl a website and output page data as NDJSON')
  .argument('<url>', 'Starting URL to crawl')
  .option('--concurrency <n>', 'Number of parallel workers', '10')
  .option('--max-pages <n>', 'Maximum number of pages to crawl')
  .option('--delay <ms>', 'Delay between requests in ms', '0')
  .option('--timeout <ms>', 'Request timeout in ms', '10000')
  .option('--output <file>', 'Output file path (default: stdout)')
  .option('--ignore-robots', 'Ignore robots.txt', false)
  .option('--depth <n>', 'Maximum crawl depth')
  .option('--ignore-query-params', 'Treat URLs with different query params as the same URL', false)
  .option('--format <type>', 'Output format: json or ndjson', 'ndjson')
  .option('--checkpoint <file>', 'Checkpoint file path for resume support')
  .option('--playwright', 'Use Playwright for JS-rendered pages', false)
  .option('--output-dir <dir>', 'Output directory (saves as {hostname}_{timestamp}.json[l])')
  .option('--ignore-ssl-errors', 'Skip TLS certificate verification (useful for sites with untrusted certs)', false)
  .action(async (url: string, opts) => {
    const format = opts.format as string;
    if (format !== 'json' && format !== 'ndjson') {
      process.stderr.write(`Error: --format must be "json" or "ndjson", got "${format}"\n`);
      process.exit(1);
    }

    const options: CrawlerOptions = {
      startUrl: url,
      concurrency: parseInt(opts.concurrency, 10),
      maxPages: opts.maxPages != null ? parseInt(opts.maxPages as string, 10) : null,
      delay: parseInt(opts.delay, 10),
      timeout: parseInt(opts.timeout, 10),
      output: (opts.output as string | undefined) ?? null,
      ignoreRobots: opts.ignoreRobots as boolean,
      depth: opts.depth != null ? parseInt(opts.depth as string, 10) : null,
      ignoreQueryParams: opts.ignoreQueryParams as boolean,
      format: format as 'json' | 'ndjson',
      checkpoint: (opts.checkpoint as string | undefined) ?? null,
      playwright: opts.playwright as boolean,
      ignoreSslErrors: opts.ignoreSslErrors as boolean,
      outputDir: (opts.outputDir as string | undefined) ?? null,
    };

    let fetcher: IFetcher;

    if (options.playwright) {
      const { PlaywrightFetcher } = await import('./playwrightFetcher.js');
      const pf = new PlaywrightFetcher({ timeout: options.timeout });
      await pf.init();
      fetcher = pf;
    } else {
      fetcher = new HttpFetcher({ timeout: options.timeout, ignoreSslErrors: options.ignoreSslErrors });
    }

    const crawler = new Crawler(options);

    try {
      await crawler.run(fetcher);
      process.exit(0);
    } catch (err) {
      process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

program.parse();
