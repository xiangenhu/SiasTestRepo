require('esbuild').build({ entryPoints: ['web/app.js'], bundle: true, minify: true, outfile: 'public/app.js', target: ['es2022'], legalComments: 'none' }).catch(() => process.exit(1));
