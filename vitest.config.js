import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: './tests/global-setup.js',
    // Test files share one database and some wipe whole tables (e.g. books.test.js), so they run one at a time.
    fileParallelism: false,
    exclude: ['.claude/**', 'node_modules/**'],
  },
});
