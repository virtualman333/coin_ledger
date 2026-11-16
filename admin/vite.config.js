import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 管理控制台是独立静态应用，挂载在 /console/。
// 构建只在本机 / CI 执行，服务器上只放 dist 产物，不在服务器构建。
export default defineConfig({
  base: '/console/',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/element-plus')) return 'element-plus';
          if (id.includes('node_modules/vue')) return 'vue-vendor';
          return undefined;
        }
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:3100'
    }
  }
});
