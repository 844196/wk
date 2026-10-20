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
  },
})
