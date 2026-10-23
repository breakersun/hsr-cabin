/// <reference types="vitest/config" />
import { defineConfig } from 'vite'

export default defineConfig({
  // 手机同局域网可直接访问 dev server（npm run dev 后用局域网 IP 打开）
  server: { host: true },
  build: {
    target: 'es2020',
    sourcemap: false,
    // 单入口无动态导入，默认产出单 chunk，便于控制 gzip 预算
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
