import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // cobertura is the format Codecov ingests; text is for the local/CI
      // console summary.
      reporter: ['text', 'cobertura'],
      // Measure the shipped source only — not tests, configs, or the bundled
      // dist/ artifact.
      include: ['src/**/*.ts'],
    },
  },
})
