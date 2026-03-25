/**
 * @suwappu/design-tokens — Canonical source of truth
 *
 * All design tokens for the Suwappu ecosystem.
 * Extracted from webapp/src/theme/tokens.ts + tailwind configs.
 */

export const designTokens = {
  name: 'Suwappu UI',
  version: '2.0.0',

  colors: {
    brand: {
      sakuraPinkLight: '#FFD1DC',
      sakuraPinkMid: '#FFB7C5',
      magentaCore: '#E91E8C',
      roseGradientStart: '#F8A5C2',
      magentaGradientMid: '#C44569',
      deepPurpleGradientEnd: '#6C3483',
      royalPurpleDeep: '#4A235A',
      /** Sakura scale (50-900) */
      sakura: {
        50: '#FFF5F7',
        100: '#FFEBEF',
        200: '#FFD1DC',
        300: '#FFB7C5',
        400: '#FF9DB0',
        500: '#FF839B',
        600: '#E66D85',
        700: '#CC576F',
        800: '#B34159',
        900: '#992B43',
      },
    },

    secondary: {
      sky: '#E8F4FD',
      cyan: '#B3E5FC',
      blue: '#87CEEB',
      navy: '#1A237E',
      ocean: '#0D1B4C',
    },

    semantic: {
      success: '#A8E6A3',
      warning: '#FFE4A0',
      error: '#F8A0A0',
      info: '#90CAF9',
    },

    impact: {
      negligible: '#4ADE80',
      low: '#22C55E',
      medium: '#FACC15',
      high: '#F97316',
      severe: '#EF4444',
    },

    txState: {
      pending: '#F59E0B',
      confirming: '#3B82F6',
      bridging: '#8B5CF6',
      success: '#22C55E',
      failed: '#EF4444',
      expired: '#6B7280',
    },

    chain: {
      ethereum: '#627EEA',
      bsc: '#F0B90B',
      polygon: '#8247E5',
      arbitrum: '#28A0F0',
      optimism: '#FF0420',
      base: '#0052FF',
      avalanche: '#E84142',
      fantom: '#1969FF',
      linea: '#121212',
      mantle: '#000000',
      gnosis: '#04795B',
      scroll: '#FFEEDA',
      solana: '#9945FF',
      sui: '#6FBCF0',
      ton: '#0098EA',
    },

    provider: {
      cow: '#EC4612',
      jupiter: '#C7F284',
      socket: '#7B3FE4',
      cctp: '#3B6EAE',
      across: '#6CF9D8',
      wormhole: '#A45EFF',
      lifi: '#EF49A0',
      layerzero: '#1E1E1E',
      ccip: '#375BD2',
    },

    neutral: {
      white: '#FFFFFF',
      background: '#FFFBFC',
      textPrimary: '#2C3E50',
      textSecondary: '#6C7A89',
      border: 'rgba(255,183,197,0.25)',
    },

    opacity: {
      overlayLight: 'rgba(255,183,197,0.08)',
      overlayMedium: 'rgba(196,69,105,0.15)',
      overlayHeavy: 'rgba(108,52,131,0.25)',
      glassEffect: 'rgba(255,255,255,0.7)',
      shadowTint: 'rgba(106,27,154,0.12)',
    },

    surface: {
      /** Consumer (sakura) dark theme */
      sakura: {
        background: '#1A1625',
        surface: '#2D2640',
        surfaceElevated: '#3D3455',
        textPrimary: '#F8F4FB',
        textSecondary: '#B8A5C8',
        border: 'rgba(255,183,197,0.15)',
      },
      /** Professional (terminal) dark theme */
      professional: {
        background: '#0A0A0F',
        bgSecondary: '#12121A',
        bgTertiary: '#1A1A2E',
        panel: '#0F0F18',
        border: '#1E1E30',
        borderActive: '#2A2A45',
        text: '#E2E2F0',
        textSecondary: '#8888A0',
        textMuted: '#55556A',
      },
    },

    trading: {
      bull: '#22C55E',
      bear: '#EF4444',
      bullDim: '#16351F',
      bearDim: '#351616',
    },
  },

  gradients: {
    primaryBrand: 'linear-gradient(135deg, #FFB7C5 0%, #C44569 35%, #6C3483 70%, #4A235A 100%)',
    buttonHover: 'linear-gradient(180deg, #F8A5C2 0%, #E91E8C 100%)',
    cardAmbient: 'linear-gradient(145deg, rgba(255,255,255,0.95) 0%, rgba(255,215,220,0.3) 100%)',
    glassLight: 'linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,215,220,0.4) 50%, rgba(232,244,253,0.6) 100%)',
    glassDark: 'linear-gradient(135deg, rgba(74,35,90,0.7) 0%, rgba(108,52,131,0.5) 100%)',
    petalGradient: 'linear-gradient(135deg, #FFD1DC 0%, #FFB7C5 50%, #F8A5C2 100%)',
    featureCard: 'linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(255,240,243,0.95) 100%)',
  },

  typography: {
    fontFamilies: {
      display: '"Pacifico", "Dancing Script", "Satisfy", cursive',
      heading: '"Quicksand", "Nunito", "Poppins", sans-serif',
      body: '"Nunito", "Open Sans", "Lato", sans-serif',
      ui: '"Nunito", sans-serif',
    },
    fontWeights: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    scale: {
      display: { fontSize: '3.5rem', fontWeight: 400, lineHeight: 1.1, letterSpacing: '0.02em' },
      h1: { fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em' },
      h2: { fontSize: '2rem', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.01em' },
      h3: { fontSize: '1.5rem', fontWeight: 600, lineHeight: 1.3, letterSpacing: '0' },
      h4: { fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.35, letterSpacing: '0' },
      bodyLarge: { fontSize: '1.125rem', fontWeight: 400, lineHeight: 1.6, letterSpacing: '0.015em' },
      body: { fontSize: '1rem', fontWeight: 400, lineHeight: 1.65, letterSpacing: '0.015em' },
      small: { fontSize: '0.875rem', fontWeight: 400, lineHeight: 1.5, letterSpacing: '0.01em' },
      caption: { fontSize: '0.75rem', fontWeight: 500, lineHeight: 1.4, letterSpacing: '0.08em', textTransform: 'uppercase' as const },
    },
  },

  spacing: {
    baseUnit: 8,
    scale: {
      xxs: 4,
      xs: 8,
      sm: 12,
      md: 16,
      lg: 24,
      xl: 32,
      xxl: 48,
      xxxl: 64,
    },
  },

  borderRadius: {
    none: 0,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 20,
    xxl: 24,
    xxxl: 28,
    full: 9999,
    pill: 50,
  },

  shadows: {
    level1: '0 1px 3px rgba(106,27,154,0.06), 0 1px 2px rgba(255,183,197,0.08)',
    level2: '0 4px 6px rgba(106,27,154,0.08), 0 2px 4px rgba(255,183,197,0.1), 0 0 0 1px rgba(255,183,197,0.05)',
    level3: '0 10px 25px rgba(106,27,154,0.12), 0 6px 10px rgba(255,183,197,0.15), 0 0 40px rgba(255,209,220,0.1)',
    level4: '0 15px 35px rgba(106,27,154,0.15), 0 10px 20px rgba(196,69,105,0.1), 0 0 60px rgba(255,183,197,0.15)',
    inset: 'inset 0 2px 4px rgba(106,27,154,0.08), inset 0 0 0 1px rgba(255,183,197,0.1)',
    glow: '0 0 20px rgba(255,183,197,0.4), 0 0 40px rgba(196,69,105,0.2), 0 0 60px rgba(108,52,131,0.1)',
    buttonPrimary: '0 4px 15px rgba(196,69,105,0.35), inset 0 1px 0 rgba(255,255,255,0.2)',
    buttonHover: '0 8px 25px rgba(196,69,105,0.45), 0 0 20px rgba(255,183,197,0.3)',
    buttonActive: '0 2px 8px rgba(196,69,105,0.3)',
  },

  glassmorphism: {
    light: {
      background: 'linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,215,220,0.4) 50%, rgba(232,244,253,0.6) 100%)',
      backdropFilter: 'blur(12px) saturate(180%)',
      border: '1px solid rgba(255,183,197,0.3)',
      borderRadius: 20,
      boxShadow: '0 8px 32px rgba(106,27,154,0.1), inset 0 0 0 1px rgba(255,255,255,0.5)',
    },
    dark: {
      background: 'linear-gradient(135deg, rgba(74,35,90,0.7) 0%, rgba(108,52,131,0.5) 100%)',
      backdropFilter: 'blur(16px) saturate(200%)',
      border: '1px solid rgba(255,183,197,0.2)',
    },
  },

  tokenIcon: {
    sm: 20,
    md: 28,
    lg: 36,
    xl: 48,
  },

  chainBadge: {
    sm: 14,
    md: 18,
    lg: 22,
  },

  animations: {
    timing: {
      fast: '150ms',
      normal: '300ms',
      slow: '500ms',
      verySlow: '800ms',
    },
    easing: {
      default: 'cubic-bezier(0.4, 0, 0.2, 1)',
      easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
      easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
      bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      spring: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
    },
    swap: {
      flip: { duration: '200ms', easing: 'cubic-bezier(0, 0, 0.2, 1)' },
      priceTick: { duration: '300ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      progressFill: { duration: '500ms', easing: 'cubic-bezier(0.4, 0, 0.2, 1)' },
      numberSpring: { duration: '400ms', easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)' },
    },
  },

  breakpoints: {
    xs: 0,
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    xxl: 1536,
  },
} as const

export type DesignTokens = typeof designTokens
