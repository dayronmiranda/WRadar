/* Simple JSON File Storage Utility */
const fs = require('fs');
const path = require('path');

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

class FileStorage {
  constructor(rootDir) {
    this.root = rootDir;
    ensureDir(this.root);
  }
  _path(key) { return path.join(this.root, `${key}.json`); }
  get(key, def = null) {
    try {
      const p = this._path(key);
      if (!fs.existsSync(p)) return def;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) { return def; }
  }
  set(key, value) {
    const p = this._path(key);
    ensureDir(path.dirname(p));
    fs.writeFileSync(p, JSON.stringify(value, null, 2));
  }
}

module.exports = FileStorage;
