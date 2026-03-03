import { Star } from 'lucide-react';
import { searchStocks, getWatchlistNews } from '@/lib/actions/finnhub.actions';
import SearchCommand from '@/components/SearchCommand';
import { getWatchlistWithData } from '@/lib/actions/watchlist.actions';
import { WatchlistTable } from '@/components/WatchlistTable';
import PortfolioRiskMeter from '@/components/PortfolioRiskMeter';
import WatchlistNews from '@/app/(root)/watchlist/WatchlistNews';

const Watchlist = async () => {
  // Run independent fetches in parallel
  const [watchlist, initialStocks] = await Promise.all([
    getWatchlistWithData(),
    searchStocks(),
  ]);
  
  // Fetch news needs watchlist symbols, so runs after
  const symbols = watchlist.map(item => item.symbol);
  const newsData = symbols.length > 0 ? await getWatchlistNews(symbols) : {};

  // Minimal data for Risk Calculator
  const riskWatchlist = watchlist.map(item => ({
    symbol: item.symbol,
    company: item.company,
    stock: { sector: item.stock.sector },
    currentData: item.currentData
  }));

  if (watchlist.length === 0) {
    return (
      <section className="watchlist">
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="watchlist-title">Watchlist</h2>
            <SearchCommand initialStocks={initialStocks} />
          </div>
          
          <div className="flex flex-col items-center justify-center py-12 px-4 bg-white dark:bg-gray-800 rounded-lg shadow">
            <Star className="h-16 w-16 text-gray-300 dark:text-gray-600 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
              Your watchlist is empty
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-center mb-6">
              Start tracking stocks by searching and adding them to your watchlist
            </p>
            <SearchCommand initialStocks={initialStocks} />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="watchlist">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="watchlist-title">Watchlist</h2>
          <SearchCommand initialStocks={initialStocks} />
        </div>
        
        <PortfolioRiskMeter watchlist={riskWatchlist} />
        
        <WatchlistTable watchlist={watchlist} />

        <WatchlistNews 
          newsData={newsData} 
          watchlist={watchlist.map(item => ({
            symbol: item.symbol,
            company: item.company
          }))}
        />
      </div>
    </section>
  );
};

export default Watchlist;