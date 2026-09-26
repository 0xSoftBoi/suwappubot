import { ImageResponse } from 'next/og';
import { OG_SIZE } from '@/lib/ogImage';

export const runtime = 'edge';
export const alt = 'Suwappu Agent Desk: give your agent a mandate, not your keys.';
export const size = OG_SIZE;
export const contentType = 'image/png';

/**
 * Social card in the DeskFlow instrument aesthetic: off-black ground, mono
 * chrome, and a three-beat miniature of the desk's authority flow. Pure
 * text/SVG so satori renders it deterministically.
 */

const card = (label: string, sub: string, accent?: string) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      width: '212px',
      height: '86px',
      padding: '0 16px',
      borderRadius: '8px',
      background: '#171e23',
      border: `1.5px solid ${accent ?? '#2a3439'}`,
      boxShadow: accent ? `0 0 26px ${accent}44` : 'none',
    }}
  >
    <span style={{ fontSize: '22px', fontFamily: 'monospace', color: '#dbe6ea' }}>{label}</span>
    <span style={{ fontSize: '15px', color: '#8fa3ad', marginTop: '4px' }}>{sub}</span>
  </div>
);

const edge = (color: string) => (
  <div style={{ display: 'flex', alignItems: 'center' }}>
    <div style={{ width: '46px', height: '3px', background: color, borderRadius: '2px' }} />
    <div
      style={{
        width: '10px',
        height: '10px',
        borderRadius: '10px',
        background: color,
        marginLeft: '-4px',
        boxShadow: `0 0 16px ${color}`,
      }}
    />
  </div>
);

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '60px 56px',
          background: '#0f1417',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'monospace',
            fontSize: '20px',
            letterSpacing: '0.14em',
            color: '#8fa3ad',
          }}
        >
          <span>SUWAPPU · AGENT DESK</span>
          <span style={{ color: '#64777f' }}>WEBMCP</span>
        </div>

        <span
          style={{
            fontSize: '76px',
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: '-0.02em',
            color: '#f2f7f9',
            maxWidth: '1000px',
          }}
        >
          Give your agent a mandate, not your keys.
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {card('your agent', 'reads, prices, proposes')}
          {edge('#e09b52')}
          {card('THE MANDATE', 'caps, chains, ceilings', '#45b3d6')}
          {edge('#45b3d6')}
          {card('YOU', 'Approve is a DOM button', '#45b3d6')}
          {edge('#3fae6f')}
          {card('it binds', 'policy, receipt, signature')}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'monospace',
            fontSize: '19px',
            color: '#64777f',
          }}
        >
          <span>19 tools on document.modelContext · every write stops at a human</span>
          <span style={{ color: '#9fb3bd' }}>suwappu.bot/agent-terminal</span>
        </div>
      </div>
    ),
    size,
  );
}
