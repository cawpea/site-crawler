export interface PageResult {
  url: string;
  title: string | null;
  metaDescription: string | null;
  statusCode: number | null;
  crawledAt: string; // ISO 8601
  depth: number;
  links: string[];
  error: string | null;
  redirectedFrom: string | null;
}

export interface QueueEntry {
  url: string;
  depth: number;
}

export interface CrawlerOptions {
  startUrl: string;
  concurrency: number;
  maxPages: number | null;
  delay: number;
  timeout: number;
  output: string | null;
  ignoreRobots: boolean;
  depth: number | null;
  ignoreQueryParams: boolean;
  format: 'json' | 'ndjson';
  checkpoint: string | null;
  playwright: boolean;
  ignoreSslErrors: boolean;
  outputDir: string | null;
}

export interface FetchResult {
  url: string; // 最終 URL（リダイレクト後）
  redirectedFrom: string | null;
  statusCode: number;
  html: string | null;
  error: string | null;
}

export interface IFetcher {
  fetch(url: string): Promise<FetchResult>;
  destroy?(): Promise<void>;
}

export interface CheckpointData {
  visitedUrls: string[];
  pendingQueue: QueueEntry[];
  crawledCount: number;
  startUrl: string;
  savedAt: string;
}
