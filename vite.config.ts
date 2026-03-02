import path from 'path';
import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const devClientLogPlugin = (): Plugin => ({
  name: 'dev-client-log-plugin',
  configureServer(server) {
    server.middlewares.use('/__client-log', (req, res, next) => {
      if (req.method !== 'POST') {
        next();
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}') as {
            level?: 'ERROR' | 'WARN' | 'INFO';
            timestamp?: string;
            context?: string;
            message?: string;
            stack?: string;
          };

          const level = payload.level || 'INFO';
          const color = level === 'ERROR' ? '\x1b[31m' : level === 'WARN' ? '\x1b[33m' : '\x1b[32m';
          const reset = '\x1b[0m';
          const icon = level === 'ERROR' ? '🔴' : level === 'WARN' ? '🟡' : '🟢';
          const ts = payload.timestamp || '--:--:--';
          const context = payload.context || 'app';
          const message = payload.message || 'Sin mensaje';

          console.log(`${color}${icon} [${level}] [${ts}] [${context}] -> ${message}${reset}`);
          if (payload.stack) {
            console.log(`${color}${payload.stack}${reset}`);
          }
        } catch (error) {
          console.error('[dev-client-log-plugin] Error parsing payload', error);
        }

        res.statusCode = 204;
        res.end();
      });
    });
  }
});

export default defineConfig(({ mode }) => {
  loadEnv(mode, '.', '');
  return {
    publicDir: 'public',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api/erp': {
          target: 'http://10.0.0.19:8000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/erp/, ''),
        },
      },
    },
    plugins: [react(), devClientLogPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      }
    }
  };
});
