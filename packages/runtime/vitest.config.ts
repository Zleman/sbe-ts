import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
  bench: {
    include: ['test/**/*.bench.ts'],
  },
});
