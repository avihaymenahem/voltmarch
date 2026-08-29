import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const MONOREPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: MONOREPO_ROOT,
  test: {
    environment: 'node',
    include: [
      'apps/desktop/tests/**/*.spec.ts',
      'tests/integration/desktop-shell.spec.ts',
      'apps/game/tests/platform-storage.spec.ts',
      'apps/game/tests/cloudflare-analytics.spec.ts',
    ],
  },
});
