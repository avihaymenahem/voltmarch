import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    watch: {
      ignored: ['**/.desktop-dev-*/**', '**/dist/**'],
    },
  },
};
