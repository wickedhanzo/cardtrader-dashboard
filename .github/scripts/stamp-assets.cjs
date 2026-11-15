const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function versionHtml(html, assets) {
  for (const file of ['app.js', 'model.js', 'styles.css']) {
    const version = createHash('sha256').update(assets[file]).digest('hex').slice(0, 16);
    const reference = new RegExp(`\\b(src|href)="${file.replace('.', '\\.')}(?:\\?v=[^"]*)?"`, 'g');
    let found = false;
    html = html.replace(reference, (_, attribute) => {
      found = true;
      return `${attribute}="${file}?v=${version}"`;
    });
    if (!found) throw new Error(`Missing dashboard asset reference: ${file}`);
  }
  return html;
}

function stamp(directory) {
  const assets = Object.fromEntries(['app.js', 'model.js', 'styles.css'].map(file => [file, fs.readFileSync(path.join(directory, file))]));
  const index = path.join(directory, 'index.html');
  fs.writeFileSync(index, versionHtml(fs.readFileSync(index, 'utf8'), assets));
}

module.exports = { versionHtml, stamp };
if (require.main === module) stamp(path.resolve(process.argv[2] || 'site'));
