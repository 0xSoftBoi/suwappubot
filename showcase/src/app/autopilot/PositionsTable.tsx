import styles from './autopilot.module.css';
import type { AutopilotPosition } from './types';

function money(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(entry: number | null, last: number | null): string {
  if (!entry || !last) return '—';
  const p = ((last - entry) / entry) * 100;
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

/**
 * The book. Open positions carry the exit plan that was committed at entry —
 * the stop and the invalidation are part of the public record, not private
 * risk settings, because they are what the next decision will be judged against.
 */
export default function PositionsTable({ positions }: { positions: AutopilotPosition[] }) {
  if (positions.length === 0) {
    return <p className={styles.empty}>No open positions. The agent is in cash.</p>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Token</th>
            <th scope="col">Cost basis</th>
            <th scope="col">Entry</th>
            <th scope="col">Last</th>
            <th scope="col">Unrealized</th>
            <th scope="col">Exit plan</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const move = pct(p.avg_entry_price_usd, p.last_price_usd);
            const up = move.startsWith('+');
            return (
              <tr key={p.id}>
                <td>
                  <span className={styles.tableSymbol}>{p.symbol}</span>{' '}
                  <span className={styles.tableMuted}>{p.chain}</span>
                </td>
                <td>{money(p.cost_basis_usd)}</td>
                <td>{money(p.avg_entry_price_usd)}</td>
                <td>
                  {money(p.last_price_usd)}{' '}
                  <span className={up ? styles.up : styles.down}>{move}</span>
                </td>
                <td className={
                  (p.unrealized_pnl_usd ?? 0) >= 0 ? styles.up : styles.down
                }>
                  {money(p.unrealized_pnl_usd)}
                </td>
                <td className={styles.tableMuted} title={p.invalidation ?? undefined}>
                  {p.stop_loss_pct ? `stop -${p.stop_loss_pct}%` : 'no stop'}
                  {p.take_profit_pct ? ` · target +${p.take_profit_pct}%` : ''}
                  {p.invalidation ? (
                    <>
                      {' · '}
                      <span className={styles.clamp}>{p.invalidation}</span>
                    </>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
