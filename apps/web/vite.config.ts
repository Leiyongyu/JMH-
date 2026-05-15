import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** 与后端共用仓库根目录 `.env`，使 `VITE_*` 生效（默认只读 `apps/web/` 下环境文件） */
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig({
  envDir: monorepoRoot,
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
});
