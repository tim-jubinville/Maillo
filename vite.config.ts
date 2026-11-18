import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'version-file',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ name: 'maillo', version: pkg.version }) + '\n' });
      }
    },
    {
      name: 'service-worker',
      apply: 'build',
      generateBundle(_, bundle) {
        const assets = Object.keys(bundle).filter((f) => f.startsWith('assets/'));
        const shell = ['./', './config.js', './manifest.webmanifest', './icon-192.png', ...assets.map((f) => `./${f}`)];
        const source = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
          .replace("'__VERSION__'", JSON.stringify(pkg.version))
          .replace('__SHELL__', JSON.stringify(shell));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      }
    }
  ],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2022'
  }
});
