import { build } from 'esbuild'

await build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	target: 'node18',
	format: 'esm',
	outdir: 'dist',
	// No shebang banner here: src/index.ts already starts with one and esbuild
	// preserves it. Adding it back emitted a second shebang on line 2, which is
	// a hard SyntaxError — the binary would not start at all.
	external: [],
})

console.log('Build complete: dist/index.js')
