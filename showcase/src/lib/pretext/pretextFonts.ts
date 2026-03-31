// Font strings matching layout.tsx (Space_Grotesk, DM_Sans, Fira_Code)
// These must exactly match the CSS fonts for accurate Canvas measurement

export const FONTS = {
  display: {
    regular: '700 24px Space Grotesk',
    large: '700 32px Space Grotesk',
    xl: '700 48px Space Grotesk',
  },
  body: {
    regular: '400 16px DM Sans',
    small: '400 14px DM Sans',
    medium: '500 16px DM Sans',
    semibold: '600 14px DM Sans',
  },
  mono: {
    regular: '400 14px Fira Code',
    small: '400 13px Fira Code',
  },
} as const;
