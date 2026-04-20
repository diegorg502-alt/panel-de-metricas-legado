const fs = require('fs');
const path = require('path');
const { minify } = require('html-minifier-terser');

async function build() {
  const DIST = 'dist';
  if (!fs.existsSync(DIST)) fs.mkdirSync(DIST, { recursive: true });

  const html = fs.readFileSync('index.html', 'utf8');
  const minified = await minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: false,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    minifyCSS: true,
    minifyJS: {
      mangle: false,
      compress: { drop_console: false, sequences: true, dead_code: true, conditionals: true, booleans: true, unused: false, if_return: true, join_vars: true }
    }
  });
  fs.writeFileSync(path.join(DIST, 'index.html'), minified);

  for (const f of ['robots.txt', '403.html']) {
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(DIST, f));
  }

  const origKB = (html.length/1024).toFixed(1);
  const newKB = (minified.length/1024).toFixed(1);
  const pct = ((1 - minified.length/html.length)*100).toFixed(1);
  console.log(`Build OK  ${origKB}KB -> ${newKB}KB  (-${pct}%)`);
}

build().catch(e => { console.error('Build failed:', e); process.exit(1); });
