import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * MAILLO_NATIVE=1 builds the iOS app (Capacitor) into dist-native: no PHP server behind it, so the
 * settings come from config.native.js (gitignored, see config.native.example.js) and there's no service worker.
 */
const native = process.env.MAILLO_NATIVE === '1';
const nativeConfig = new URL('./config.native.js', import.meta.url);

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
      name: 'native-config',
      apply: 'build',
      transformIndexHtml(html) {
        if (!native) return html;
        return html
          .replace('<script src="./config.php"></script>', '<script src="./config.native.js"></script>')
          .replace(/<link rel="manifest"[^>]*>\n/, '')
          .replace(' https://accounts.google.com/gsi/client', '');
      },
      generateBundle() {
        if (!native) return;
        if (!existsSync(nativeConfig)) this.error('Missing config.native.js: copy config.native.example.js to config.native.js and fill it in.');
        this.emitFile({ type: 'asset', fileName: 'config.native.js', source: readFileSync(nativeConfig, 'utf8') });
      },
      closeBundle() {
        // The server's PHP files and web-app manifest have no use inside the app.
        if (!native) return;
        const out = new URL('./dist-native/', import.meta.url);
        for (const f of readdirSync(out)) if (f.endsWith('.php') || f === 'manifest.webmanifest') rmSync(new URL(f, out));
      }
    },
    {
      name: 'service-worker',
      apply: (_, env) => env.command === 'build' && !native,
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
    __DEMO_BUILD__: JSON.stringify(process.env.MAILLO_DEMO === '1'),
    __NATIVE_BUILD__: JSON.stringify(native)
  },
  base: './',
  build: {
    outDir: native ? 'dist-native' : 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    target: 'es2022'
  }
});
