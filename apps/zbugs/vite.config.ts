import react from '@vitejs/plugin-react';
import {fileURLToPath, URL} from 'node:url';
import {defineConfig, type PluginOption, type ViteDevServer} from 'vite';
import svgr from 'vite-plugin-svgr';
import {makeDefine} from '../../packages/shared/src/build.ts';
import {fastify} from './api/index.ts';

const jsXxhashCjsPath = fileURLToPath(
  new URL('../../node_modules/js-xxhash/dist/cjs/index.cjs', import.meta.url),
);

async function configureServer(server: ViteDevServer) {
  await fastify.ready();
  server.middlewares.use((req, res, next) => {
    if (!req.url?.startsWith('/api')) {
      return next();
    }
    fastify.server.emit('request', req, res);
  });
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    dedupe: ['@rocicorp/zero', '@rocicorp/zero/react'],
    alias: {
      'js-xxhash': jsXxhashCjsPath,
    },
  },
  optimizeDeps: {
    include: ['@databases/sql', '@databases/escape-identifier'],
    exclude: [
      '@rocicorp/zero',
      '@rocicorp/zero/react',
      '@rocicorp/zero-virtual',
    ],
  },
  plugins: [
    svgr() as unknown as PluginOption,
    react() as unknown as PluginOption,
    {
      name: 'api-server',
      configureServer,
    },
  ],
  define: makeDefine(),
  build: {
    target: 'esnext',
    rollupOptions: {
      input: {
        main: '/index.html',
        debug: '/debug.html',
        roci: '/roci.html',
      },
    },
  },
});
