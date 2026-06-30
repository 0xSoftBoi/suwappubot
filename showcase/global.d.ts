// Ambient declarations for side-effect style imports (`import './x.css'`).
// TypeScript 6 stopped silently allowing untyped side-effect imports, so plain
// CSS imports need an ambient module declaration. Next.js handles the actual
// bundling; this only satisfies the type checker.
declare module '*.css'
