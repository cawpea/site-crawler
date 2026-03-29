import { fetch as undiciFetch } from 'undici';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const robotsParser = require('robots-parser') as (url: string, content: string) => { isAllowed(url: string, ua: string): boolean | undefined };

const USER_AGENT = 'site-crawler/1.0';

interface IRobotsChecker {
  isAllowed(url: string): Promise<boolean>;
}

class NoopRobotsChecker implements IRobotsChecker {
  async isAllowed(): Promise<boolean> {
    return true;
  }
}

class RealRobotsChecker implements IRobotsChecker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private cache = new Map<string, any>();

  async isAllowed(url: string): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const origin = parsed.origin;
      const robots = await this.getRobots(origin);
      return robots.isAllowed(url, USER_AGENT) !== false;
    } catch {
      return true;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getRobots(origin: string): Promise<any> {
    if (this.cache.has(origin)) {
      return this.cache.get(origin);
    }

    const robotsUrl = `${origin}/robots.txt`;
    let content = '';

    try {
      const response = await undiciFetch(robotsUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        content = await response.text();
      }
    } catch {
      // Fail-open: treat as no restrictions
    }

    const robots = robotsParser(robotsUrl, content);
    this.cache.set(origin, robots);
    return robots;
  }
}

export function createRobotsChecker(ignoreRobots: boolean): IRobotsChecker {
  if (ignoreRobots) return new NoopRobotsChecker();
  return new RealRobotsChecker();
}
