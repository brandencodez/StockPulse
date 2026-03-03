'use server';

import { auth } from '../better-auth/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getWatchlistSymbolsByEmail } from './watchlist.actions';
import { FINNHUB_BASE_URL, POPULAR_STOCK_SYMBOLS } from '../constants';
import {
  formatPrice,
  formatChangePercent,
  formatMarketCapValue,
  getPastDate,
  getFormattedTodayDate,
  finnhubRateLimiter,
  stockProfileCache,
  stockQuoteCache,
  newsCache,
  searchCache,
  fetchJSON,
} from '../utils';
import { cache } from 'react';

//  Load token safely once
const FINNHUB_API_KEY =
  process.env.FINNHUB_API_KEY || process.env.NEXT_PUBLIC_FINNHUB_API_KEY;

if (!FINNHUB_API_KEY) {
  console.error('⚠️ Missing FINNHUB_API_KEY environment variable');
}

// Helper function to fetch with rate limiting and retry logic
async function fetchWithRateLimit<T>(
  url: string,
  cacheKey?: string,
  cache?: any
): Promise<T> {
  // Check cache first if provided
  if (cache && cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit: ${cacheKey}`);
      return cached;
    }
  }

  // Fetch with rate limiting
  return finnhubRateLimiter.execute(async () => {
    try {
      const response = await fetch(url);

      if (response.status === 429) {
        console.warn('⚠️ Rate limit hit, waiting before retry...');
        // Wait 2 seconds and retry once
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const retryResponse = await fetch(url);
        if (!retryResponse.ok) {
          throw new Error(`Fetch failed after retry: ${retryResponse.status}`);
        }
        const data = await retryResponse.json();

        // Cache the result
        if (cache && cacheKey) {
          cache.set(cacheKey, data);
        }

        return data;
      }

      if (!response.ok) {
        throw new Error(`Fetch failed with status ${response.status}`);
      }

      const data = await response.json();

      // Cache the result
      if (cache && cacheKey) {
        cache.set(cacheKey, data);
      }

      return data;
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      throw error;
    }
  });
}

// Search stocks + mark watchlist status
export const searchStocks = cache(
  async (query?: string): Promise<StockWithWatchlistStatus[]> => {
    try {
      const authInstance = await auth();
      const session = await authInstance.api.getSession({
        headers: await headers(),
      });
      if (!session?.user) redirect('/sign-in');

      const userWatchlistSymbols = await getWatchlistSymbolsByEmail(
        session.user.email
      );

      const token = process.env.FINNHUB_API_KEY ?? FINNHUB_API_KEY;
      if (!token) {
        // If no token, log and return empty to avoid throwing per requirements
        console.error(
          'Error in stock search:',
          new Error('FINNHUB API key is not configured')
        );
        return [];
      }

      const trimmed = typeof query === 'string' ? query.trim() : '';

      let results: FinnhubSearchResult[] = [];

      if (!trimmed) {
        // Fetch top 10 popular symbols' profiles
        const top = POPULAR_STOCK_SYMBOLS.slice(0, 10);
        const profiles = await Promise.all(
          top.map(async (sym) => {
            try {
              const url = `${FINNHUB_BASE_URL}/stock/profile2?symbol=${encodeURIComponent(
                sym
              )}&token=${token}`;
              // Revalidate every hour
              const profile = await fetchJSON(url);
              return { sym, profile } as { sym: string; profile: any };
            } catch (e) {
              console.error('Error fetching profile2 for', sym, e);
              return { sym, profile: null } as { sym: string; profile: any };
            }
          })
        );

        results = profiles
          .map(({ sym, profile }) => {
            const symbol = sym.toUpperCase();
            const name: string | undefined =
              profile?.name || profile?.ticker || undefined;
            const exchange: string | undefined = profile?.exchange || undefined;
            if (!name) return undefined;
            const r: FinnhubSearchResult = {
              symbol,
              description: name,
              displaySymbol: symbol,
              type: 'Common Stock',
            };
            
            
            (r as any).__exchange = exchange; // internal only
            return r;
          })
          .filter((x): x is FinnhubSearchResult => Boolean(x));
      } else {
        const url = `${FINNHUB_BASE_URL}/search?q=${encodeURIComponent(
          trimmed
        )}&token=${token}`;
        const data = await fetchJSON(url);
        results = Array.isArray(data?.result) ? data.result : [];
      }

      const mapped: StockWithWatchlistStatus[] = results
        .map((r) => {
          const upper = (r.symbol || '').toUpperCase();
          const name = r.description || upper;
          const exchangeFromDisplay =
            (r.displaySymbol as string | undefined) || undefined;
          const exchangeFromProfile = (r as any).__exchange as
            | string
            | undefined;
          const exchange = exchangeFromDisplay || exchangeFromProfile || 'US';
          const type = r.type || 'Stock';
          const item: StockWithWatchlistStatus = {
            symbol: upper,
            name,
            exchange,
            type,
            isInWatchlist: userWatchlistSymbols.includes(
              r.symbol.toUpperCase()
            ),
          };
          return item;
        })
        .slice(0, 15);

      return mapped;
    } catch (err) {
      console.error('Error in stock search:', err);
      return [];
    }
  }
);

// Fetch full stock details

export const getStocksDetails = cache(async (symbol: string) => {
  const cleanSymbol = symbol.trim().toUpperCase();

  try {
    const [quote, profile, financials] = await Promise.all([
      fetchJSON(
        `${FINNHUB_BASE_URL}/quote?symbol=${cleanSymbol}&token=${FINNHUB_API_KEY}`
      ),
      fetchJSON(
        `${FINNHUB_BASE_URL}/stock/profile2?symbol=${cleanSymbol}&token=${FINNHUB_API_KEY}`
      ),
      fetchJSON(
        `${FINNHUB_BASE_URL}/stock/metric?symbol=${cleanSymbol}&metric=all&token=${FINNHUB_API_KEY}`
      ),
    ]);

    const quoteData = quote as QuoteData;
    const profileData = profile as ProfileData;
    const financialsData = financials as FinancialsData;

    if (!quoteData?.c || !profileData?.name)
      throw new Error('Invalid stock data received from API');

    //  EXTRACT ALL REQUIRED FIELDS
    const currentPrice = quoteData.c;
    const dayHigh = quoteData.h;      
    const dayLow = quoteData.l;       
    const sector = profileData.finnhubIndustry || 'Unknown'; 
    const changePercent = quoteData.dp || 0;
    const peRatio = financialsData?.metric?.peNormalizedAnnual || null;
    const marketCap = profileData?.marketCapitalization || 0;

    return {
      symbol: cleanSymbol,
      company: profileData.name,
      currentPrice,
      dayHigh,           
      dayLow,            
      sector,            
      changePercent,
      peRatio,
      marketCap,       
      
    };
  } catch (error) {
    console.error(`Error fetching details for ${cleanSymbol}:`, error);
    throw new Error('Failed to fetch stock details');
  }
});

//  Fetch latest or company-specific news
export async function getNews(symbol?: string) {
  try {
    const cacheKey = symbol ? `news:${symbol}` : 'news:general';

    // Check cache first
    const cachedNews = newsCache.get(cacheKey);
    if (cachedNews) {
      console.log(`Cache hit: news for ${symbol || 'general'}`);
      return cachedNews;
    }

    const endpoint = symbol
      ? `${FINNHUB_BASE_URL}/company-news?symbol=${symbol}&from=${getPastDate(
          7
        )}&to=${getFormattedTodayDate()}&token=${FINNHUB_API_KEY}`
      : `${FINNHUB_BASE_URL}/news?category=general&token=${FINNHUB_API_KEY}`;

    const data = await fetchWithRateLimit(endpoint, cacheKey, newsCache);
    const news = Array.isArray(data) ? data.slice(0, 10) : [];

    return news;
  } catch (error) {
    console.error('Error fetching news:', error);
    return [];
  }
}

export interface NewsArticle {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

// Fetch news for a single company 
export async function getCompanyNews(symbol: string): Promise<NewsArticle[]> {
  try {
    const news = await getNews(symbol);
    return news.slice(0, 2); // Return only 2 most recent articles per stock
  } catch (error) {
    console.error(`Error fetching news for ${symbol}:`, error);
    return [];
  }
}

// Fetch news for all watchlist stocks
export async function getWatchlistNews(symbols: string[]): Promise<Record<string, NewsArticle[]>> {
  try {
    // Use Promise.all to fetch news for all symbols concurrently
    const newsPromises = symbols.map(async (symbol) => {
      const news = await getCompanyNews(symbol);
      return { symbol, news };
    });
    
    const results = await Promise.all(newsPromises);
    
    // Convert array to object map for easier lookup
    const newsMap: Record<string, NewsArticle[]> = {};
    results.forEach(({ symbol, news }) => {
      newsMap[symbol] = news;
    });
    
    return newsMap;
  } catch (error) {
    console.error('Error fetching watchlist news:', error);
    return {};
  }
}