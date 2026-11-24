import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { existsSync, readFileSync } from 'node:fs';

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
      // The dev server can't run PHP: it answers config.php with config.local.js (gitignored) if there is one.
      name: 'dev-config',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (!req.url?.split('?')[0].endsWith('/config.php')) return next();
          const local = new URL('./config.local.js', import.meta.url);
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.end(existsSync(local) ? readFileSync(local, 'utf8') : '');
        });
      }
    },
    {
      name: 'service-worker',
      apply: 'build',
      generateBundle(_, bundle) {
        const assets = Object.keys(bundle).filter((f) => f.startsWith('assets/'));
        const shell = ['./', './config.php', './manifest.webmanifest', './icon-192.png', ...assets.map((f) => `./${f}`)];
        const source = readFileSync(new URL('./sw/sw.js', import.meta.url), 'utf8')
          .replace("'__VERSION__'", JSON.stringify(pkg.version))
          .replace('__SHELL__', JSON.stringify(shell));
        this.emitFile({ type: 'asset', fileName: 'sw.js', source });
      }
    }
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEMO_BUILD__: JSON.stringify(process.env.MAILLO_DEMO === '1')
  },
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2022'
  }
});
