export default function StockDetailLoading() {
  return (
    <div className="flex min-h-screen p-4 md:p-6 lg:p-8">
      <section className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          {/* Symbol info skeleton */}
          <div className="h-[170px] w-full rounded-lg bg-muted/50 animate-pulse" />
          {/* Chart skeleton */}
          <div className="h-[600px] w-full rounded-lg bg-muted/30 animate-pulse flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-muted animate-bounce [animation-delay:-0.3s]" />
                <div className="h-3 w-3 rounded-full bg-muted animate-bounce [animation-delay:-0.15s]" />
                <div className="h-3 w-3 rounded-full bg-muted animate-bounce" />
              </div>
              <p className="text-xs text-muted-foreground">Loading chart&hellip;</p>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          {/* Watchlist button skeleton */}
          <div className="flex items-center justify-between">
            <div className="h-10 w-44 rounded-md bg-muted animate-pulse" />
          </div>
          {/* Details cards skeleton */}
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-24 w-full rounded-lg bg-muted/40 animate-pulse"
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
