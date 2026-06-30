import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    environment: 'node',
    // In CI, also emit a JUnit report for Codecov Test Analytics; locally the
    // default reporter is enough, so we don't litter the tree with XML. The path
    // matches what the reusable CI workflow uploads (coverage/junit.xml).
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'coverage/junit.xml' },
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
