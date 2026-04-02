import { createHash } from 'node:crypto';
import { createWriteStream, type WriteStream } from 'node:fs';
import { writeFile, rename, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import pLimit from 'p-limit';
import type { CrawlerOptions, IFetcher, PageResult, QueueEntry, CheckpointData } from './types.js';
import { createUrlNormalizer, isSameDomain, isNonHtmlUrl } from './urlUtils.js';
import { parseHtml } from './parser.js';
import { createRobotsChecker } from './robotsChecker.js';

const CHECKPOINT_INTERVAL = 100;

const CSV_HEADER = 'url,title,metaDescription,statusCode,crawledAt,depth,linkCount,error,redirectedFrom';

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replaceAll('"', '""') + '"';
  }
  return str;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class Crawler {
  private queue: QueueEntry[] = [];
  private queueHead = 0; // O(1) dequeue without Array.shift()
  private visited = new Set<string>();
  private totalCrawled = 0;
  private shuttingDown = false;
  private outputStream!: NodeJS.WritableStream;
  private fileStream: WriteStream | null = null;
  private normalizeUrl: ReturnType<typeof createUrlNormalizer>;
  private robotsChecker: ReturnType<typeof createRobotsChecker>;
  private fetcher!: IFetcher;
  private contentHashes = new Set<string>();

  // Mark visited immediately on enqueue to prevent duplicates accumulating in queue.
  // A URL that is linked by N pages would otherwise appear N times in the queue
  // before any of them gets processed.
  private tryEnqueue(url: string, depth: number): void {
    if (this.visited.has(url)) return;
    this.visited.add(url);
    this.queue.push({ url, depth });
  }

  private dequeue(): QueueEntry | undefined {
    if (this.queueHead >= this.queue.length) return undefined;
    const entry = this.queue[this.queueHead++];
    // Compact the backing array periodically to reclaim memory
    if (this.queueHead > 10000) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
    return entry;
  }

  private get queueSize(): number {
    return this.queue.length - this.queueHead;
  }

  constructor(private options: CrawlerOptions) {
    this.normalizeUrl = createUrlNormalizer(options.ignoreQueryParams);
    this.robotsChecker = createRobotsChecker(options.ignoreRobots);
  }

  async run(fetcher: IFetcher): Promise<void> {
    this.fetcher = fetcher;
    this.setupShutdown();
    await this.setupOutputStream();

    if (this.options.format === 'json') {
      this.write('[\n');
    } else if (this.options.format === 'csv') {
      this.write(CSV_HEADER + '\n');
    }

    await this.loadCheckpoint();

    const normalizedStart = this.normalizeUrl(this.options.startUrl);
    if (normalizedStart) this.tryEnqueue(normalizedStart, 0);

    await this.drain();
    await this.finalizeOutput();
    await this.saveCheckpoint();
    await this.fetcher.destroy?.();
  }

  private resolveOutputPath(): string | null {
    if (this.options.output) return this.options.output;
    if (this.options.outputDir) {
      const hostname = new URL(this.options.startUrl).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const ext = this.options.format === 'json' ? 'json'
               : this.options.format === 'csv'  ? 'csv'
               : 'ndjson';
      return join(this.options.outputDir, `${hostname}_${ts}.${ext}`);
    }
    return null;
  }

  private async setupOutputStream(): Promise<void> {
    const outputPath = this.resolveOutputPath();
    if (outputPath) {
      if (this.options.outputDir) {
        await mkdir(this.options.outputDir, { recursive: true });
      }
      this.fileStream = createWriteStream(outputPath, { encoding: 'utf8' });
      this.outputStream = this.fileStream;
      process.stderr.write(`Output: ${outputPath}\n`);
    } else {
      this.outputStream = process.stdout;
    }
  }

  private write(data: string): void {
    this.outputStream.write(data);
  }

  private setupShutdown(): void {
    const handler = () => {
      process.stderr.write('\nReceived signal, finishing in-flight requests...\n');
      this.shuttingDown = true;
      this.queue = [];
      this.queueHead = 0;
    };
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  }

  private async drain(): Promise<void> {
    const limit = pLimit(this.options.concurrency);
    const promises = new Set<Promise<void>>();

    const schedule = () => {
      while (
        this.queueSize > 0 &&
        !this.isAtPageLimit() &&
        !this.shuttingDown
      ) {
        const entry = this.dequeue()!;
        const p = limit(() => this.processEntry(entry)).then(() => {
          promises.delete(p);
          schedule();
        }).catch(() => {
          promises.delete(p);
          schedule();
        });
        promises.add(p);
      }
    };

    schedule();

    while (promises.size > 0) {
      await Promise.race(promises);
      schedule();
    }
  }

  private isAtPageLimit(): boolean {
    return this.options.maxPages !== null && this.totalCrawled >= this.options.maxPages;
  }

  private async processEntry(entry: QueueEntry): Promise<void> {
    if (this.options.delay > 0) {
      await sleep(this.options.delay);
    }

    const allowed = await this.robotsChecker.isAllowed(entry.url);
    if (!allowed) {
      process.stderr.write(`[robots] Skipping: ${entry.url}\n`);
      return;
    }

    const fetchResult = await this.fetcher.fetch(entry.url);
    const crawledAt = new Date().toISOString();

    let links: string[] = [];
    let title: string | null = null;
    let metaDescription: string | null = null;

    if (fetchResult.html) {
      if (this.options.dedupeContent) {
        const hash = createHash('sha256').update(fetchResult.html).digest('hex');
        if (this.contentHashes.has(hash)) {
          process.stderr.write(`[dedupe] Skipping duplicate content: ${fetchResult.url}\n`);
          return;
        }
        this.contentHashes.add(hash);
      }

      const parsed = parseHtml(fetchResult.html, fetchResult.url, this.normalizeUrl);
      title = parsed.title;
      metaDescription = parsed.metaDescription;
      links = parsed.links;

      // Enqueue new links
      if (!this.shuttingDown) {
        for (const link of links) {
          if (!isSameDomain(link, this.options.startUrl)) continue;
          if (isNonHtmlUrl(link)) continue;
          if (this.options.depth !== null && entry.depth + 1 > this.options.depth) continue;
          this.tryEnqueue(link, entry.depth + 1); // visited check is inside tryEnqueue
        }
      }
    }

    // Check page limit before writing
    if (this.isAtPageLimit()) return;

    const pageResult: PageResult = {
      url: fetchResult.url,
      title,
      metaDescription,
      statusCode: fetchResult.statusCode || null,
      crawledAt,
      depth: entry.depth,
      links,
      error: fetchResult.error,
      redirectedFrom: fetchResult.redirectedFrom,
    };

    this.writeResult(pageResult);
    this.totalCrawled++;

    if (this.totalCrawled % CHECKPOINT_INTERVAL === 0) {
      await this.saveCheckpoint();
    }

    process.stderr.write(`[${this.totalCrawled}] ${fetchResult.url}\n`);
  }

  private writeResult(result: PageResult): void {
    if (this.options.format === 'ndjson') {
      this.write(JSON.stringify(result) + '\n');
    } else if (this.options.format === 'json') {
      if (this.totalCrawled > 0) this.write(',\n');
      this.write(JSON.stringify(result));
    } else {
      // csv
      const row = [
        result.url,
        result.title,
        result.metaDescription,
        result.statusCode,
        result.crawledAt,
        result.depth,
        result.links.length,
        result.error,
        result.redirectedFrom,
      ].map(csvCell).join(',');
      this.write(row + '\n');
    }
  }

  private async finalizeOutput(): Promise<void> {
    if (this.options.format === 'json') {
      this.write('\n]');
    }
    if (this.fileStream) {
      await new Promise<void>((resolve, reject) => {
        this.fileStream!.end((err: Error | null | undefined) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  private async saveCheckpoint(): Promise<void> {
    if (!this.options.checkpoint) return;

    const data: CheckpointData = {
      visitedUrls: Array.from(this.visited),
      pendingQueue: this.queue.slice(this.queueHead),
      crawledCount: this.totalCrawled,
      startUrl: this.options.startUrl,
      savedAt: new Date().toISOString(),
    };

    const tmpPath = this.options.checkpoint + '.tmp';
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    await rename(tmpPath, this.options.checkpoint);
  }

  private async loadCheckpoint(): Promise<void> {
    if (!this.options.checkpoint) return;

    try {
      const raw = await readFile(this.options.checkpoint, 'utf-8');
      const data: CheckpointData = JSON.parse(raw);

      if (data.startUrl !== this.options.startUrl) {
        process.stderr.write('Checkpoint startUrl mismatch, ignoring checkpoint\n');
        return;
      }

      for (const u of data.visitedUrls) {
        this.visited.add(u);
      }
      // Prepend pending queue without spread (avoids call stack overflow on large arrays)
      this.queue = [...data.pendingQueue, ...this.queue.slice(this.queueHead)];
      this.queueHead = 0;
      this.totalCrawled = data.crawledCount;

      process.stderr.write(
        `Resumed from checkpoint: ${data.crawledCount} already crawled, ${data.pendingQueue.length} queued\n`
      );
    } catch {
      // No checkpoint or corrupt — start fresh
    }
  }
}
