import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatTimeAgo = (timestamp: number) => {
  const now = Date.now();
  const diffInMs = now - timestamp * 1000; // Convert to milliseconds
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInMinutes = Math.floor(diffInMs / (1000 * 60));

  if (diffInHours > 24) {
    const days = Math.floor(diffInHours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (diffInHours >= 1) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  } else {
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  }
};

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatMarketCapValue(marketCapUsd: number): string {
  if (!Number.isFinite(marketCapUsd) || marketCapUsd <= 0) return 'N/A';

  if (marketCapUsd >= 1e12) return `$${(marketCapUsd / 1e12).toFixed(2)}T`; // Trillions
  if (marketCapUsd >= 1e9) return `$${(marketCapUsd / 1e9).toFixed(2)}B`; // Billions
  if (marketCapUsd >= 1e6) return `$${(marketCapUsd / 1e6).toFixed(2)}M`; // Millions
  return `$${marketCapUsd.toFixed(2)}`; 
}

export const getDateRange = (days: number) => {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - days);
  return {
    to: toDate.toISOString().split('T')[0],
    from: fromDate.toISOString().split('T')[0],
  };
};

// Get today's date range (from today to today)
export const getTodayDateRange = () => {
  const today = new Date();
  const todayString = today.toISOString().split('T')[0];
  return {
    to: todayString,
    from: todayString,
  };
};

// Calculate news per symbol based on watchlist size
export const calculateNewsDistribution = (symbolsCount: number) => {
  let itemsPerSymbol: number;
  let targetNewsCount = 6;

  if (symbolsCount < 3) {
    itemsPerSymbol = 3; // Fewer symbols, more news each
  } else if (symbolsCount === 3) {
    itemsPerSymbol = 2; // Exactly 3 symbols, 2 news each = 6 total
  } else {
    itemsPerSymbol = 1; // Many symbols, 1 news each
    targetNewsCount = 6; // Don't exceed 6 total
  }

  return { itemsPerSymbol, targetNewsCount };
};

// Check for required article fields
export const validateArticle = (article: RawNewsArticle) =>
  article.headline && article.summary && article.url && article.datetime;

// Get today's date string in YYYY-MM-DD format
export const getTodayString = () => new Date().toISOString().split('T')[0];

export const formatArticle = (
  article: RawNewsArticle,
  isCompanyNews: boolean,
  symbol?: string,
  index: number = 0
) => ({
  id: isCompanyNews ? Date.now() + Math.random() : article.id + index,
  headline: article.headline!.trim(),
  summary:
    article.summary!.trim().substring(0, isCompanyNews ? 200 : 150) + '...',
  source: article.source || (isCompanyNews ? 'Company News' : 'Market News'),
  url: article.url!,
  datetime: article.datetime!,
  image: article.image || '',
  category: isCompanyNews ? 'company' : article.category || 'general',
  related: isCompanyNews ? symbol! : article.related || '',
});

export const formatChangePercent = (changePercent?: number) => {
  if (!changePercent) return '';
  const sign = changePercent > 0 ? '+' : '';
  return `${sign}${changePercent.toFixed(2)}%`;
};

export const getChangeColorClass = (changePercent?: number) => {
  if (!changePercent) return 'text-gray-400';
  return changePercent > 0 ? 'text-green-500' : 'text-red-500';
};

export const formatPrice = (price: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(price);
};

export const formatDateToday = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
});

export const getAlertText = (alert: Alert) => {
  const condition = alert.alertType === 'upper' ? '>' : '<';
  return `Price ${condition} ${formatPrice(alert.threshold)}`;
};

export const getFormattedTodayDate = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`; // Returns "2025-10-27"
};


//ENHANCED fetchJSON WITH RATE LIMITING + CACHING + NEXT.JS REVALIDATION

export async function fetchJSON<T = any>(url: string): Promise<T> {
  // 1. DETERMINE CACHE STRATEGY BASED ON ENDPOINT TYPE
  const isQuote = url.includes('/quote?');
  const isProfile = url.includes('/stock/profile2?');
  const isMetric = url.includes('/stock/metric?');
  const isNews = url.includes('/news') || url.includes('/company-news');
  const isSearch = url.includes('/search?');

  const memCache = isQuote
    ? stockQuoteCache
    : isProfile
      ? stockProfileCache
      : isSearch
        ? searchCache
        : newsCache;

  // Next.js fetch-level revalidation (seconds)
  const revalidateSec = isProfile
    ? 3600   // 1 hour — profiles rarely change
    : isMetric
      ? 1800 // 30 min — financials
      : isNews
        ? 600  // 10 min — news
        : isSearch
          ? 1800 // 30 min — search results
          : 30;  // 30 sec — live quotes

  // Normalized cache key (strip API token for dedup)
  let cacheKey = url;
  try {
    const urlObj = new URL(url);
    const symbol = urlObj.searchParams.get('symbol');
    if (symbol) {
      cacheKey = `${urlObj.pathname}?symbol=${symbol}`;
    }
  } catch (_e) {
    // Fallback to full URL if parsing fails
  }

  // 2. RETURN CACHED DATA IF AVAILABLE
  const cached = memCache.get(cacheKey) as T | null;
  if (cached) {
    console.log(`[CACHE HIT] ${cacheKey}`);
    return cached;
  }

  // 3. EXECUTE WITH RATE LIMITING (concurrent — up to 25 req/sec)
  try {
    const result = await finnhubRateLimiter.execute(async (): Promise<T> => {
      console.log(`[FETCHING] ${cacheKey}`);
      const response = await fetch(url, {
        next: { revalidate: revalidateSec },
      });

      // 4. HANDLE 429 ERRORS (retry once after 1s delay)
      if (response.status === 429) {
        console.warn('⚠️ Finnhub rate limited — retrying in 1s');
        await delay(1000);
        return fetchJSON<T>(url);
      }

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} for ${url}`);
      }

      return (await response.json()) as T;
    });

    // 5. CACHE SUCCESSFUL RESPONSE
    memCache.set(cacheKey, result);
    return result;
  } catch (error) {
    // 6. STALE CACHE FALLBACK
    if (cached) {
      console.warn(`[STALE CACHE] Using outdated data for ${cacheKey}`);
      return cached;
    }
    throw error;
  }
}

export function getPastDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}


//  CONCURRENT RATE LIMITER (Token-bucket style, 25 req/sec for 30/sec Finnhub limit)


class RateLimiter {
  private timestamps: number[] = [];
  private maxPerSecond: number;
  private pendingQueue: Array<{
    fn: () => Promise<any>;
    resolve: (v: any) => void;
    reject: (e: any) => void;
  }> = [];
  private drainScheduled = false;

  constructor(maxPerSecond: number = 25) {
    this.maxPerSecond = maxPerSecond;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pendingQueue.push({ fn: fn as () => Promise<any>, resolve, reject });
      this.drain();
    });
  }

  private cleanTimestamps() {
    const now = Date.now();
    this.timestamps = this.timestamps.filter((t) => now - t < 1000);
  }

  private drain() {
    this.cleanTimestamps();

    // Launch as many concurrent requests as the rate limit allows
    while (
      this.pendingQueue.length > 0 &&
      this.timestamps.length < this.maxPerSecond
    ) {
      const item = this.pendingQueue.shift()!;
      this.timestamps.push(Date.now());

      // Fire without awaiting — enables true concurrency
      item
        .fn()
        .then((result) => {
          item.resolve(result);
          this.drain(); // free slot → try next
        })
        .catch((error) => {
          item.reject(error);
          this.drain();
        });
    }

    // Schedule retry for remaining items when oldest timestamp expires
    if (this.pendingQueue.length > 0 && !this.drainScheduled) {
      this.drainScheduled = true;
      const oldest = this.timestamps[0] ?? Date.now();
      const waitMs = Math.max(50, 1000 - (Date.now() - oldest) + 10);
      setTimeout(() => {
        this.drainScheduled = false;
        this.drain();
      }, waitMs);
    }
  }
}

// Export singleton — allows ~25 concurrent requests per second (safe buffer for 30/sec Finnhub limit)
export const finnhubRateLimiter = new RateLimiter(25);


// CACHE SYSTEM


interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class SimpleCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number; // time to live in milliseconds

  constructor(ttlMinutes: number = 5) {
    this.ttl = ttlMinutes * 60 * 1000;
  }

  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) return null;

    // Check if cache is still valid
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  clear(): void {
    this.cache.clear();
  }

  delete(key: string): void {
    this.cache.delete(key);
  }
}

// Export cache instances with appropriate TTLs
export const stockProfileCache = new SimpleCache<any>(60); // 60 minutes for profiles
export const stockQuoteCache = new SimpleCache<any>(1); // 1 minute for quotes
export const newsCache = new SimpleCache<any>(10); // 10 minutes for news
export const searchCache = new SimpleCache<any>(5); // 5 minutes for search results