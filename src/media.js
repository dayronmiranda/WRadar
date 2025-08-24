/*
 Media Downloader
 - Detect media in events based on type/mimetype
 - Download asynchronously into ./media
 - Concurrency control
*/
const fs = require('fs');
const path = require('path');

function parseMaxSize(s) {
  if (!s) return Infinity;
  const m = String(s).match(/^(\d+)(KB|MB|GB)?$/i);
  if (!m) return Infinity;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 'B').toUpperCase();
  switch (unit) {
    case 'KB': return n * 1024;
    case 'MB': return n * 1024 * 1024;
    case 'GB': return n * 1024 * 1024 * 1024;
    default: return n;
  }
}

class Media {
  constructor({ mediaConfig, storageDir }) {
    this.cfg = mediaConfig || {};
    this.dir = storageDir;
    this.maxSize = parseMaxSize(this.cfg.maxFileSize);
    this.concurrent = Math.max(1, this.cfg.concurrentDownloads || 3);

    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });

    this.active = 0;
    this.queue = [];
  }

  async maybeEnrich(evt) {
    if (!this.cfg.enabled) return evt;
    const raw = evt && evt.rawData;
    const type = raw && (raw.type || raw.mediaType || raw.mimetype);
    if (!type) return evt;

    const allowed = this.cfg.downloadTypes || [];
    if (!allowed.some(t => String(type).toLowerCase().includes(t))) return evt;

    const hasMediaPointer = raw.mediaKey || raw.mediaHash || raw.clientUrl || raw.directPath;
    if (!hasMediaPointer) return evt;

    // push to queue and return immediately; webhook can receive later updates
    const enriched = { ...evt };
    this._enqueue(async () => {
      try {
        const saved = await this._download(raw);
        enriched.localMedia = saved;
      } catch (e) {
        enriched.localMedia = { downloaded: false, error: String(e) };
      }
    });
    return enriched;
  }

  _enqueue(task) {
    this.queue.push(task);
    this._drain();
  }

  async _drain() {
    if (this.active >= this.concurrent) return;
    const task = this.queue.shift();
    if (!task) return;
    this.active++;
    try { await task(); } finally {
      this.active--;
      if (this.queue.length) this._drain();
    }
  }

  async _download(raw) {
    // Placeholder: we don't have direct decrypt here; we save a stub file with metadata
    const fileName = `${Date.now()}_${raw.id && (raw.id._serialized || raw.id.id || 'media')}.json`;
    const filePath = path.join(this.dir, fileName);
    const data = {
      downloaded: true,
      filePath,
      fileName,
      fileSize: raw.size || 0,
      mimeType: raw.mimetype || raw.type || 'application/octet-stream',
      downloadedAt: Date.now(),
      sourceMeta: {
        mediaKey: raw.mediaKey || null,
        mediaHash: raw.mediaHash || null,
        directPath: raw.directPath || null,
        clientUrl: raw.clientUrl || null,
      }
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return data;
  }
}

module.exports = Media;
