/**
 * Self-contained tsdown config for the external dsh-smoothly-chat bundle.
 *
 * Two build products:
 *  - `lib/index.js` — the host half loaded by the DSH loader (node/ESM). DSH
 *    host packages stay external; they resolve from the profile at load time.
 *  - `lib/core.js`  — the testable core (protocol, store, peer server,
 *    outbox). No DSH imports at all, so the repository's node scripts can
 *    import it directly without a DSH runtime.
 *  - `lib/client.js` — the browser bundle speaking the loader's module-table
 *    contract (`window.__ModuleLoader__.load({ id, factory })`).
 */

import { defineConfig } from 'tsdown'

const ID = 'dsh-smoothly-chat'

/** Externals answered by the loader module table (platform seed + runtime store exemption). */
const CLIENT_EXTERNALS: readonly string[] = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-connection/client',
  '@deepseek-ai/dsh-client-locale/client',
]

/** Node-half entries: the loader-facing host plugin plus the DSH-free core. */
const node = {
  name: ID,
  entry: { index: 'src/index.ts', core: 'src/core/public.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: {
    neverBundle: ['@deepseek-ai/cordis'],
  },
  outputOptions: {
    entryFileNames: '[name].js',
  },
}

/** Browser client bundle served at /plugins/dsh-smoothly-chat/client.js. */
const client = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default defineConfig([node, client])
