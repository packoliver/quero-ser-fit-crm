import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve('./src'),
    },
  },
  test: {
    environment: 'node',
    // Exclui node_modules e scripts de auditoria VPS que usam node:test (não vitest)
    exclude: ['**/node_modules/**', '**/scripts/__tests__/**'],
  },
})
