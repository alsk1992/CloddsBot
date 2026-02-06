/**
 * Reddit Feed
 *
 * Polls Reddit public JSON API for hot posts (free, no auth needed).
 * Deduplicates by tracking seen post IDs.
 */

import type { AltDataEvent } from '../types.js';
import { logger } from '../../../utils/logger.js';

const DEFAULT_INTERVAL_MS = 300_000; // 5 min
const DEFAULT_SUBREDDITS = ['polymarket', 'cryptocurrency', 'wallstreetbets'];
const POSTS_PER_SUB = 10;

export interface RedditFeed {
  start(): void;
  stop(): void;
  poll(): Promise<AltDataEvent[]>;
}

interface RedditPost {
  data: {
    id: string;
    title: string;
    selftext?: string;
    author: string;
    url: string;
    permalink: string;
    score: number;
    num_comments: number;
    created_utc: number;
    subreddit: string;
    link_flair_text?: string;
  };
}

interface RedditListing {
  data?: {
    children?: RedditPost[];
  };
}

export function createRedditFeed(
  onEvent: (event: AltDataEvent) => void,
  subreddits: string[] = DEFAULT_SUBREDDITS,
  intervalMs: number = DEFAULT_INTERVAL_MS,
): RedditFeed {
  let timer: ReturnType<typeof setInterval> | null = null;
  const seenIds = new Set<string>();
  // Cap memory — only track last 5000 posts
  const MAX_SEEN = 5000;

  function trimSeen(): void {
    if (seenIds.size > MAX_SEEN) {
      const arr = Array.from(seenIds);
      const toRemove = arr.slice(0, arr.length - MAX_SEEN);
      for (const id of toRemove) seenIds.delete(id);
    }
  }

  async function fetchSubreddit(sub: string): Promise<AltDataEvent[]> {
    const events: AltDataEvent[] = [];
    const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=${POSTS_PER_SUB}&raw_json=1`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Clodds/1.0 (alt-data feed)' },
      });

      if (!res.ok) {
        logger.debug({ status: res.status, sub }, '[reddit] Subreddit fetch failed');
        return events;
      }

      let listing: RedditListing;
      try {
        listing = (await res.json()) as RedditListing;
      } catch {
        logger.debug({ sub }, '[reddit] Invalid JSON response');
        return events;
      }
      const posts = listing.data?.children ?? [];

      for (const post of posts) {
        const { id, title, selftext, author, permalink, score, num_comments, subreddit, link_flair_text } = post.data;

        if (seenIds.has(id)) continue;
        seenIds.add(id);

        // Only care about posts with some traction
        if (score < 5 && num_comments < 3) continue;

        const categories = ['reddit', subreddit.toLowerCase()];
        if (link_flair_text) categories.push(link_flair_text.toLowerCase());

        const event: AltDataEvent = {
          id: `reddit-${id}`,
          source: 'reddit_post',
          timestamp: Date.now(),
          text: title,
          body: selftext?.slice(0, 500),
          url: `https://reddit.com${permalink}`,
          author,
          categories,
          meta: { score, numComments: num_comments, subreddit },
        };

        events.push(event);
        onEvent(event);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        logger.debug({ error, sub }, '[reddit] Poll failed for subreddit');
      }
    } finally {
      clearTimeout(timeout);
    }

    return events;
  }

  async function poll(): Promise<AltDataEvent[]> {
    const results = await Promise.allSettled(
      subreddits.map((sub) => fetchSubreddit(sub)),
    );

    const events: AltDataEvent[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        events.push(...result.value);
      }
    }

    trimSeen();
    return events;
  }

  function start(): void {
    if (timer) return;
    poll().catch(() => {});
    timer = setInterval(() => { poll().catch(() => {}); }, intervalMs);
    logger.info({ intervalMs, subreddits }, '[reddit] Feed started');
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, poll };
}
