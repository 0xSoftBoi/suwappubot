import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * Shared dark cosmic OG/Twitter card renderer. Text-based by design (no
 * external images/fonts) so it stays legible and stays out of next/og's
 * font-loading edge cases. Matches the site's dark CRT/cosmic aesthetic —
 * deep space background, cyan accent, mono tagline.
 */
export function renderOgImage(tagline: string) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px',
          background:
            'radial-gradient(circle at 22% 20%, #0F2A3D 0%, #0A1420 45%, #050810 100%)',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: '2px solid rgba(14,165,233,0.35)',
            margin: '24px',
            borderRadius: '28px',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '5px',
              background: '#0EA5E9',
              boxShadow: '0 0 32px 6px rgba(14,165,233,0.65)',
            }}
          />
          <span
            style={{
              fontSize: '40px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#F5FAFF',
            }}
          >
            suwappu
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <span
            style={{
              fontSize: '64px',
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              color: '#FFFFFF',
              maxWidth: '980px',
            }}
          >
            {tagline}
          </span>
          <span
            style={{
              fontSize: '26px',
              color: '#7DD3FC',
              fontFamily: 'monospace',
            }}
          >
            suwappu.bot
          </span>
        </div>
      </div>
    ),
    { ...OG_SIZE }
  );
}
