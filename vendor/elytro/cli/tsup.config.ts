import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as {
  version: string;
};

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  define: {
    __PACKAGE_VERSION__: JSON.stringify(pkg.version),
  },
});
