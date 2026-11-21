'use client';

/**
 * One calm state per admin section: skeleton while loading, a single friendly
 * card (with retry) on failure. Presentation only: callers pass the SAME load
 * function they already use. The raw error stays behind a "Details" disclosure.
 */
export function SectionSkeleton({ what, rows = 4 }: { what: string; rows?: number }) {
  return (
    <div className="adm-sk" role="status" aria-label={`Loading ${what}`}>
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} className="adm-sk__row" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
    </div>
  );
}

export function SectionError({ what, onRetry, detail }: { what: string; onRetry: () => void; detail?: string }) {
  return (
    <div className="adm-state" role="alert">
      <span className="adm-state__mark" aria-hidden="true" />
      <div className="adm-state__body">
        <strong>Couldn&rsquo;t load {what}.</strong>
        <span>Nothing is lost. Try again in a moment.</span>
        {detail && (
          <details className="adm-state__detail">
            <summary>Details</summary>
            <code>{detail}</code>
          </details>
        )}
      </div>
      <button type="button" className="adm-state__retry" onClick={onRetry}>Try again</button>
    </div>
  );
}
