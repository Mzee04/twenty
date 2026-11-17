'use strict';

const esbuild = require('esbuild');

const preview = process.argv.includes('--preview');

esbuild.build({
  entryPoints: ['renderer.js'],
  bundle: true,
  outfile: preview ? 'dist/preview.bundle.js' : 'dist/renderer.bundle.js',
  platform: 'browser',
  format: 'iife',
  logLevel: 'warning',
  legalComments: 'none',
  define: {
    'process.env.TWENTY_PREVIEW': preview ? 'true' : 'false',
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
