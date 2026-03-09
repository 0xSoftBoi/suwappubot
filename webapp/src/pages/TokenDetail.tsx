/**
 * Token detail page with TradingView chart, safety score, and quick trade.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PriceChart } from '../components/charts/PriceChart';
import { useApi } from '../hooks/useApi';

interface TokenInfo {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  marketCap: number;
  volume24h: number;
  chain: string;
  address: string;
  safetyScore: number | null;
  safetyLevel: string | null;
  warnings: string[];
}

export function TokenDetail() {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const api = useApi();
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;

    const fetchToken = async () => {
      try {
        const data = await api.get(`/webapp/token/${symbol}`);
        setToken(data);
      } catch (e) {
        console.error('Failed to fetch token:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchToken();
  }, [symbol, api]);

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-skeleton" style={{ height: 600 }} />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="page-container">
        <p>Token not found</p>
        <button onClick={() => navigate(-1)}>Go Back</button>
      </div>
    );
  }

  const isPositive = token.change24h >= 0;
  const changeColor = isPositive ? '#14F195' : '#FF453A';

  return (
    <div className="page-container" style={{ padding: 0 }}>
      {/* Header */}
      <div style={{
        padding: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', color: '#fff' }}>
            ${token.symbol}
          </h2>
          <span style={{ color: '#A0A0B4', fontSize: '14px' }}>
            {token.name} · {token.chain}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#fff' }}>
            ${token.price < 1 ? token.price.toFixed(6) : token.price.toFixed(2)}
          </div>
          <div style={{ color: changeColor, fontSize: '14px', fontWeight: 600 }}>
            {isPositive ? '+' : ''}{token.change24h.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Safety badge */}
      {token.safetyScore !== null && (
        <div style={{
          margin: '0 16px 8px',
          padding: '8px 12px',
          borderRadius: '8px',
          background: token.safetyScore >= 70 ? '#14F19515' :
                     token.safetyScore >= 40 ? '#F0B90B15' : '#FF453A15',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            fontSize: '14px',
            fontWeight: 600,
            color: token.safetyScore >= 70 ? '#14F195' :
                   token.safetyScore >= 40 ? '#F0B90B' : '#FF453A',
          }}>
            Safety: {token.safetyScore}/100 ({token.safetyLevel})
          </span>
          {token.warnings.length > 0 && (
            <span style={{ color: '#A0A0B4', fontSize: '12px' }}>
              · {token.warnings[0]}
            </span>
          )}
        </div>
      )}

      {/* Price chart */}
      <PriceChart
        tokenSymbol={token.symbol}
        chain={token.chain}
        height={350}
        defaultInterval="1h"
      />

      {/* Stats grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        padding: '16px',
      }}>
        <StatBox label="Market Cap" value={formatLargeNumber(token.marketCap)} />
        <StatBox label="24h Volume" value={formatLargeNumber(token.volume24h)} />
        <StatBox label="Chain" value={token.chain} />
        <StatBox
          label="Address"
          value={token.address ? `${token.address.slice(0, 6)}...${token.address.slice(-4)}` : '—'}
        />
      </div>

      {/* Quick trade buttons */}
      <div style={{
        display: 'flex',
        gap: '12px',
        padding: '16px',
        position: 'sticky',
        bottom: 0,
        background: '#12121E',
      }}>
        <button
          onClick={() => navigate(`/swap?to=${token.symbol}&chain=${token.chain}`)}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: '12px',
            border: 'none',
            background: '#14F195',
            color: '#000',
            fontWeight: 700,
            fontSize: '16px',
            cursor: 'pointer',
          }}
        >
          Buy {token.symbol}
        </button>
        <button
          onClick={() => navigate(`/swap?from=${token.symbol}&chain=${token.chain}`)}
          style={{
            flex: 1,
            padding: '14px',
            borderRadius: '12px',
            border: 'none',
            background: '#FF453A',
            color: '#fff',
            fontWeight: 700,
            fontSize: '16px',
            cursor: 'pointer',
          }}
        >
          Sell {token.symbol}
        </button>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: '#1C1C30',
      borderRadius: '10px',
      padding: '12px',
    }}>
      <div style={{ color: '#646478', fontSize: '12px', marginBottom: '4px' }}>
        {label}
      </div>
      <div style={{ color: '#fff', fontSize: '16px', fontWeight: 600 }}>
        {value}
      </div>
    </div>
  );
}

function formatLargeNumber(n: number): string {
  if (!n) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export default TokenDetail;
