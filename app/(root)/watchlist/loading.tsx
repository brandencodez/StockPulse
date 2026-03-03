export default function WatchlistLoading() {
  return (
    <section className="watchlist">
      <div className="flex flex-col gap-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div className="h-8 w-40 rounded-md bg-muted animate-pulse" />
          <div className="h-10 w-32 rounded-md bg-muted animate-pulse" />
        </div>

        {/* Risk meter skeleton */}
        <div className="h-28 w-full rounded-lg bg-muted/50 animate-pulse" />

        {/* Table skeleton */}
        <div className="rounded-lg border border-border/50 overflow-hidden">
          {/* Table header */}
          <div className="flex gap-4 px-4 py-3 bg-muted/30">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 flex-1 rounded bg-muted animate-pulse" />
            ))}
          </div>
          {/* Table rows */}
          {Array.from({ length: 5 }).map((_, row) => (
            <div
              key={row}
              className="flex gap-4 px-4 py-4 border-t border-border/30"
              style={{ animationDelay: `${row * 100}ms` }}
            >
              {Array.from({ length: 6 }).map((_, col) => (
                <div
                  key={col}
                  className="h-4 flex-1 rounded bg-muted/40 animate-pulse"
                  style={{ animationDelay: `${(row * 6 + col) * 50}ms` }}
                />
              ))}
            </div>
          ))}
        </div>

        {/* News skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-border/50 p-4 space-y-3"
              style={{ animationDelay: `${i * 150}ms` }}
            >
              <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-3 w-full rounded bg-muted/40 animate-pulse" />
              <div className="h-3 w-2/3 rounded bg-muted/40 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
