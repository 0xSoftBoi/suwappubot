import type { CSSProperties, ReactNode } from 'react'

export type TerminalThemeMode = 'precision' | 'desk' | 'studio'

type TerminalThemeVars = Record<`--terminal-${string}`, string>

const shellBackgrounds: Record<TerminalThemeMode, string> = {
  precision:
    'radial-gradient(circle at top right, rgba(229,141,43,0.14), transparent 24%), radial-gradient(circle at left center, rgba(248,228,190,0.24), transparent 18%), linear-gradient(180deg, #fffefb 0%, #fffaf3 100%)',
  desk:
    'radial-gradient(circle at top right, rgba(244,201,99,0.18), transparent 28%), radial-gradient(circle at left center, rgba(248,228,190,0.4), transparent 22%), linear-gradient(180deg, #fffefb 0%, #fff9f0 100%)',
  studio:
    'radial-gradient(circle at top right, rgba(244,201,99,0.22), transparent 30%), radial-gradient(circle at left center, rgba(234,244,255,0.35), transparent 26%), linear-gradient(180deg, #fffefb 0%, #fff7ed 100%)',
}

const themeVars: Record<TerminalThemeMode, TerminalThemeVars> = {
  precision: {
    '--terminal-shell-background': shellBackgrounds.precision,
    '--terminal-panel-background': 'rgba(255, 255, 255, 0.96)',
    '--terminal-inset-background': 'rgba(255, 249, 240, 0.92)',
    '--terminal-card-background': 'rgba(255, 255, 255, 0.94)',
    '--terminal-control-background': 'rgba(255, 255, 255, 0.94)',
    '--terminal-control-background-hover': '#ffffff',
    '--terminal-control-background-active': '#ffffff',
    '--terminal-border-color': '#deceb3',
    '--terminal-border-active-color': '#cfae78',
    '--terminal-radius-panel': '18px',
    '--terminal-radius-inset': '14px',
    '--terminal-radius-card': '12px',
    '--terminal-radius-control': '12px',
    '--terminal-radius-pill': '14px',
    '--terminal-shadow-panel': '0 18px 36px rgba(176,126,64,0.12), 0 6px 14px rgba(216,200,166,0.14), inset 0 1px 0 rgba(255,255,255,0.86)',
    '--terminal-shadow-panel-elevated': '0 24px 52px rgba(176,126,64,0.16), 0 10px 20px rgba(216,200,166,0.16), inset 0 1px 0 rgba(255,255,255,0.9)',
    '--terminal-shadow-inset': 'inset 0 1px 0 rgba(255,255,255,0.84), 0 0 0 1px rgba(255,255,255,0.24)',
    '--terminal-shadow-card': '0 4px 12px rgba(176,126,64,0.08), inset 0 1px 0 rgba(255,255,255,0.62)',
    '--terminal-shadow-control': 'inset 0 1px 0 rgba(255,255,255,0.88), 0 1px 2px rgba(216,200,166,0.14)',
    '--terminal-shadow-raised': '0 8px 18px rgba(176,126,64,0.12), inset 0 1px 0 rgba(255,255,255,0.88)',
    '--terminal-button-background': 'linear-gradient(180deg, #efb84a 0%, #e58d2b 100%)',
    '--terminal-button-background-hover': 'linear-gradient(180deg, #f4c963 0%, #d37322 100%)',
    '--terminal-button-shadow': '0 10px 20px rgba(229,141,43,0.18), inset 0 1px 0 rgba(255,255,255,0.34)',
    '--terminal-button-shadow-hover': '0 14px 26px rgba(229,141,43,0.24), inset 0 1px 0 rgba(255,255,255,0.38)',
    '--terminal-heading-tracking': '-0.045em',
    '--terminal-caption-tracking': '0.2em',
  },
  desk: {
    '--terminal-shell-background': shellBackgrounds.desk,
    '--terminal-panel-background': '#ffffff',
    '--terminal-inset-background': '#fff8ee',
    '--terminal-card-background': 'rgba(255, 255, 255, 0.92)',
    '--terminal-control-background': '#ffffff',
    '--terminal-control-background-hover': '#ffffff',
    '--terminal-control-background-active': '#ffffff',
    '--terminal-border-color': '#e6d9c3',
    '--terminal-border-active-color': '#d8be90',
    '--terminal-radius-panel': '22px',
    '--terminal-radius-inset': '18px',
    '--terminal-radius-card': '16px',
    '--terminal-radius-control': '16px',
    '--terminal-radius-pill': '18px',
    '--terminal-shadow-panel': '0 20px 44px rgba(176,126,64,0.14), 0 10px 22px rgba(216,200,166,0.18), inset 0 1px 0 rgba(255,255,255,0.84)',
    '--terminal-shadow-panel-elevated': '0 28px 60px rgba(176,126,64,0.18), 0 12px 24px rgba(216,200,166,0.2), inset 0 1px 0 rgba(255,255,255,0.9)',
    '--terminal-shadow-inset': 'inset 0 1px 0 rgba(255,255,255,0.8)',
    '--terminal-shadow-card': '0 4px 10px rgba(176,126,64,0.08), inset 0 1px 0 rgba(255,255,255,0.62)',
    '--terminal-shadow-control': 'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(216,200,166,0.2)',
    '--terminal-shadow-raised': '0 8px 18px rgba(176,126,64,0.12), inset 0 1px 0 rgba(255,255,255,0.88)',
    '--terminal-button-background': 'linear-gradient(180deg, #f1bf57 0%, #e58d2b 100%)',
    '--terminal-button-background-hover': 'linear-gradient(180deg, #f4c963 0%, #d37322 100%)',
    '--terminal-button-shadow': '0 12px 24px rgba(229,141,43,0.22), inset 0 1px 0 rgba(255,255,255,0.36)',
    '--terminal-button-shadow-hover': '0 16px 30px rgba(229,141,43,0.26), inset 0 1px 0 rgba(255,255,255,0.4)',
    '--terminal-heading-tracking': '-0.04em',
    '--terminal-caption-tracking': '0.22em',
  },
  studio: {
    '--terminal-shell-background': shellBackgrounds.studio,
    '--terminal-panel-background': 'rgba(255, 255, 255, 0.94)',
    '--terminal-inset-background': 'rgba(255, 249, 240, 0.86)',
    '--terminal-card-background': 'rgba(255, 255, 255, 0.9)',
    '--terminal-control-background': 'rgba(255, 255, 255, 0.9)',
    '--terminal-control-background-hover': '#ffffff',
    '--terminal-control-background-active': '#ffffff',
    '--terminal-border-color': '#eadac1',
    '--terminal-border-active-color': '#d8be90',
    '--terminal-radius-panel': '28px',
    '--terminal-radius-inset': '22px',
    '--terminal-radius-card': '18px',
    '--terminal-radius-control': '18px',
    '--terminal-radius-pill': '20px',
    '--terminal-shadow-panel': '0 26px 64px rgba(176,126,64,0.16), 0 12px 28px rgba(216,200,166,0.18), inset 0 1px 0 rgba(255,255,255,0.88)',
    '--terminal-shadow-panel-elevated': '0 34px 72px rgba(176,126,64,0.18), 0 14px 30px rgba(216,200,166,0.2), inset 0 1px 0 rgba(255,255,255,0.92)',
    '--terminal-shadow-inset': 'inset 0 1px 0 rgba(255,255,255,0.78), 0 0 0 1px rgba(255,255,255,0.18)',
    '--terminal-shadow-card': '0 6px 14px rgba(176,126,64,0.1), inset 0 1px 0 rgba(255,255,255,0.68)',
    '--terminal-shadow-control': 'inset 0 1px 0 rgba(255,255,255,0.92), 0 2px 6px rgba(216,200,166,0.18)',
    '--terminal-shadow-raised': '0 10px 22px rgba(176,126,64,0.14), inset 0 1px 0 rgba(255,255,255,0.9)',
    '--terminal-button-background': 'linear-gradient(180deg, #f4c963 0%, #e58d2b 100%)',
    '--terminal-button-background-hover': 'linear-gradient(180deg, #f6cf85 0%, #d37322 100%)',
    '--terminal-button-shadow': '0 14px 28px rgba(229,141,43,0.24), inset 0 1px 0 rgba(255,255,255,0.38)',
    '--terminal-button-shadow-hover': '0 18px 34px rgba(229,141,43,0.28), inset 0 1px 0 rgba(255,255,255,0.42)',
    '--terminal-heading-tracking': '-0.035em',
    '--terminal-caption-tracking': '0.24em',
  },
}

export function TerminalThemeScope({
  children,
  mode = 'precision',
}: {
  children: ReactNode
  mode?: TerminalThemeMode
}) {
  return (
    <div
      className="terminal-theme-root"
      data-terminal-theme={mode}
      style={themeVars[mode] as CSSProperties}
    >
      {children}
    </div>
  )
}
