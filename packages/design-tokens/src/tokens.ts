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
      persimmonCream: '#FFF8EE',
      sunlitFlesh: '#F8E4BE',
      persimmonCore: '#E58D2B',
      goldenCalyx: '#F4C963',
      burntStem: '#B75D21',
      inkBrown: '#5B3A24',
      // Legacy aliases kept for compatibility with older consumers.
      sakuraPinkLight: '#FFF8EE',
      sakuraPinkMid: '#F7E6C7',
      magentaCore: '#E58D2B',
      roseGradientStart: '#F4C963',
      magentaGradientMid: '#D9772D',
      deepPurpleGradientEnd: '#B75D21',
      royalPurpleDeep: '#5B3A24',
      /** Persimmon scale (50-900). `sakura` remains as an alias for compatibility. */
      persimmon: {
        50: '#FFFCF7',
        100: '#FFF6EA',
        200: '#FCE6C2',
        300: '#F6CF85',
        400: '#EDA650',
        500: '#E58D2B',
        600: '#D37322',
        700: '#B75D21',
        800: '#864521',
        900: '#5B3A24',
      },
      sakura: {
        50: '#FFFCF7',
        100: '#FFF6EA',
        200: '#FCE6C2',
        300: '#F6CF85',
        400: '#EDA650',
        500: '#E58D2B',
        600: '#D37322',
        700: '#B75D21',
        800: '#864521',
        900: '#5B3A24',
      },
    },

    secondary: {
      sky: '#EAF4FF',
      cyan: '#D8EEF8',
      blue: '#A5CBEE',
      navy: '#34506A',
      ocean: '#6B98BF',
    },

    semantic: {
      success: '#73C38F',
      warning: '#E7C76A',
      error: '#D97863',
      info: '#7FB6E8',
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
      background: '#FFFDF9',
      textPrimary: '#2F221A',
      textSecondary: '#7B6A57',
      border: 'rgba(216, 200, 166, 0.45)',
    },

    opacity: {
      overlayLight: 'rgba(245, 201, 99, 0.08)',
      overlayMedium: 'rgba(229, 141, 43, 0.14)',
      overlayHeavy: 'rgba(169, 95, 41, 0.2)',
      glassEffect: 'rgba(255, 255, 255, 0.82)',
      shadowTint: 'rgba(176, 126, 64, 0.12)',
    },

    surface: {
      /** Consumer light theme */
      sakura: {
        background: '#FFFDF9',
        surface: '#FFFFFF',
        surfaceElevated: '#FFF8EE',
        textPrimary: '#2F221A',
        textSecondary: '#7B6A57',
        border: 'rgba(216, 200, 166, 0.42)',
      },
      /** Professional light theme */
      professional: {
        background: '#FFFDF9',
        bgSecondary: '#FFF8EE',
        bgTertiary: '#F7EEDA',
        panel: '#FFFFFF',
        border: '#E6D9C3',
        borderActive: '#D8BE90',
        text: '#2F221A',
        textSecondary: '#7B6A57',
        textMuted: '#AD987E',
      },
      /** Summer Breeze light terminal palette */
      summerBreeze: {
        canvas: '#FFFEFB',
        canvasWarm: '#FFF8ED',
        canvasCool: '#EDF8FB',
        panelCool: 'rgba(237, 248, 251, 0.94)',
        insetCool: 'rgba(247, 251, 252, 0.94)',
        cardCool: 'rgba(241, 251, 252, 0.94)',
        controlCool: 'rgba(246, 252, 253, 0.98)',
        controlActiveCool: 'rgba(241, 251, 252, 0.98)',
        sunlight: 'rgba(244, 218, 162, 0.28)',
        sunlightStrong: 'rgba(244, 218, 162, 0.42)',
        calyxGlow: 'rgba(244, 201, 99, 0.16)',
        calyxGlowStrong: 'rgba(244, 201, 99, 0.24)',
        breeze: 'rgba(154, 218, 228, 0.22)',
        breezeStrong: 'rgba(154, 218, 228, 0.34)',
        aquaWash: 'rgba(94, 234, 212, 0.12)',
        border: '#E7DCC8',
        borderActive: '#77BFD0',
        accent: '#0EA5E9',
        accentLight: '#38BDF8',
        accentHoverLight: '#67CFFB',
        accentHover: '#22B4ED',
        accentDeep: '#0284C7',
        accentDeepHover: '#0369A1',
        shadowCool: 'rgba(33, 88, 110, 0.08)',
        shadowCoolSoft: 'rgba(33, 88, 110, 0.05)',
        shadowWarm: 'rgba(176, 126, 64, 0.1)',
      },
    },

    trading: {
      bull: '#22C55E',
      bear: '#EF4444',
      bullDim: '#EAF8EF',
      bearDim: '#FCEDEA',
    },
  },

  gradients: {
    primaryBrand: 'linear-gradient(135deg, #FFF8EE 0%, #F6CF85 28%, #E58D2B 58%, #B75D21 100%)',
    buttonHover: 'linear-gradient(180deg, #F6CF85 0%, #E58D2B 100%)',
    cardAmbient: 'linear-gradient(160deg, rgba(255,255,255,0.98) 0%, rgba(255,248,238,0.96) 45%, rgba(248,228,190,0.72) 100%)',
    glassLight: 'linear-gradient(135deg, rgba(255,255,255,0.88) 0%, rgba(255,248,238,0.84) 50%, rgba(234,244,255,0.78) 100%)',
    glassDark: 'linear-gradient(135deg, rgba(91,58,36,0.84) 0%, rgba(169,95,41,0.56) 100%)',
    petalGradient: 'linear-gradient(135deg, #FFF2E7 0%, #F8DAC6 48%, #F3BB93 100%)',
    featureCard: 'linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(255,251,245,0.96) 100%)',
    summerBreeze: {
      shellBackground:
        'radial-gradient(circle at 8% 10%, rgba(244,218,162,0.28), transparent 18%), radial-gradient(circle at 92% 16%, rgba(154,218,228,0.22), transparent 18%), radial-gradient(circle at 78% 82%, rgba(244,201,99,0.16), transparent 20%), linear-gradient(180deg, #fffefb 0%, #fff8ed 42%, #edf8fb 100%)',
      panelBackground:
        'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,251,245,0.97) 42%, rgba(237,248,251,0.94) 100%)',
      insetBackground:
        'linear-gradient(180deg, rgba(255,253,248,0.96) 0%, rgba(247,251,252,0.94) 100%)',
      cardBackground:
        'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,250,243,0.96) 54%, rgba(241,251,252,0.94) 100%)',
      controlBackground:
        'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(255,251,246,0.96) 100%)',
      controlBackgroundHover:
        'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(246,252,253,0.98) 100%)',
      controlBackgroundActive:
        'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(241,251,252,0.98) 100%)',
      buttonBackground:
        'linear-gradient(180deg, #38bdf8 0%, #0ea5e9 52%, #0284c7 100%)',
      buttonBackgroundHover:
        'linear-gradient(180deg, #67cffb 0%, #22b4ed 52%, #0369a1 100%)',
      panelOrb:
        'radial-gradient(circle at 0% 0%, rgba(255,255,255,0.72), transparent 34%), radial-gradient(circle at 100% 0%, rgba(244,218,162,0.24), transparent 28%), radial-gradient(circle at 82% 100%, rgba(154,218,228,0.18), transparent 26%)',
      insetOrb:
        'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.58), transparent 26%), radial-gradient(circle at 0% 100%, rgba(94,234,212,0.12), transparent 22%)',
      cardOrb:
        'radial-gradient(circle at 100% 0%, rgba(255,255,255,0.64), transparent 28%), radial-gradient(circle at 0% 100%, rgba(154,218,228,0.14), transparent 22%)',
      controlOrb:
        'linear-gradient(180deg, rgba(255,255,255,0.46) 0%, transparent 42%)',
    },
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
    level1: '0 1px 3px rgba(91,58,36,0.05), 0 1px 2px rgba(216,200,166,0.08)',
    level2: '0 4px 10px rgba(176,126,64,0.08), 0 2px 4px rgba(216,200,166,0.12), 0 0 0 1px rgba(216,200,166,0.08)',
    level3: '0 12px 28px rgba(176,126,64,0.12), 0 6px 12px rgba(216,200,166,0.16), 0 0 40px rgba(246,207,133,0.12)',
    level4: '0 20px 44px rgba(176,126,64,0.16), 0 10px 20px rgba(216,200,166,0.18), 0 0 60px rgba(246,207,133,0.16)',
    inset: 'inset 0 2px 4px rgba(176,126,64,0.08), inset 0 0 0 1px rgba(216,200,166,0.12)',
    glow: '0 0 20px rgba(246,207,133,0.35), 0 0 40px rgba(229,141,43,0.18), 0 0 60px rgba(169,95,41,0.08)',
    buttonPrimary: '0 6px 18px rgba(229,141,43,0.28), inset 0 1px 0 rgba(255,255,255,0.35)',
    buttonHover: '0 10px 28px rgba(229,141,43,0.32), 0 0 20px rgba(246,207,133,0.22)',
    buttonActive: '0 2px 8px rgba(183,93,33,0.24)',
  },

  glassmorphism: {
    light: {
      background: 'linear-gradient(135deg, rgba(255,255,255,0.88) 0%, rgba(255,248,238,0.84) 50%, rgba(234,244,255,0.78) 100%)',
      backdropFilter: 'blur(12px) saturate(180%)',
      border: '1px solid rgba(216, 200, 166, 0.32)',
      borderRadius: 20,
      boxShadow: '0 8px 32px rgba(176,126,64,0.1), inset 0 0 0 1px rgba(255,255,255,0.56)',
    },
    dark: {
      background: 'linear-gradient(135deg, rgba(91,58,36,0.84) 0%, rgba(169,95,41,0.56) 100%)',
      backdropFilter: 'blur(16px) saturate(200%)',
      border: '1px solid rgba(216, 200, 166, 0.22)',
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
