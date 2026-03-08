import { build } from 'esbuild'

await build({
	entryPoints: ['src/index.ts'],
	bundle: true,
	platform: 'node',
	target: 'node18',
	format: 'esm',
	outdir: 'dist',
	banner: {
		js: '#!/usr/bin/env node',
	},
	external: [],
})

console.log('Build complete: dist/index.js')
