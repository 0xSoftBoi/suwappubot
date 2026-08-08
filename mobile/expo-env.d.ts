/// <reference types="expo/types" />

// Ambient declaration for the design-tokens workspace package, which ships
// TypeScript source (no build step) and has no generated .d.ts.
declare module '@suwappu/design-tokens/react-native' {
  export const sakuraTheme: typeof import('../packages/design-tokens/src/react-native').sakuraTheme
  export const professionalTheme: typeof import('../packages/design-tokens/src/react-native').professionalTheme
}
