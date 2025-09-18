import { defineConfig } from 'vite';
import typia from '@ryoppippi/unplugin-typia/vite';

export default defineConfig({
  plugins: [
    typia(), // no options needed
  ],
  build: {
    lib: {
      entry: 'src/server/wssDevServer.ts', // your backend/library entry point
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [], // external dependencies
    },
  },
});
