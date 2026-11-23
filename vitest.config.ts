import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      // `bun build` embeds `with { type: 'text' }` imports as strings, but Vite
      // would parse the file as JavaScript.
      name: 'text-import',
      enforce: 'pre',
      transform(code, id) {
        if (id.endsWith('.eta')) {
          return { code: `export default ${JSON.stringify(code)}`, map: null }
        }
      },
    },
  ],
  test: {
    include: ['src/**/*.test.ts'],
    // The forks pool's watchdog calls `child.channel.unref()`, which Bun's
    // `child_process` lacks: https://github.com/oven-sh/bun/issues/33593
    pool: 'threads',
  },
})
