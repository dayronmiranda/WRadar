/*
 MessageMedia Class - Based on whatsapp-web.js MessageMedia
 - Represents downloaded media content
 - Handles base64 data, mimetype, filename, and filesize
 - Provides utility methods for media manipulation
*/

class MessageMedia {
  constructor(mimetype, data, filename, filesize) {
    this.mimetype = mimetype;
    this.data = data; // base64 string
    this.filename = filename;
    this.filesize = filesize;
  }

  /**
   * Creates a MessageMedia instance from a file path
   * @param {string} filePath - Path to the file
   * @returns {MessageMedia} MessageMedia instance
   */
  static fromFilePath(filePath) {
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const buffer = fs.readFileSync(filePath);
    const data = buffer.toString('base64');
    const filename = path.basename(filePath);
    
    // Try to get mimetype, fallback to basic detection
    let mimetype = 'application/octet-stream';
    try {
      const mime = require('mime-types');
      mimetype = mime.lookup(filePath) || 'application/octet-stream';
    } catch (e) {
      // Fallback to basic extension detection
      const ext = path.extname(filePath).toLowerCase();
      const basicMimeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'audio/ogg',
        '.mp3': 'audio/mpeg',
        '.pdf': 'application/pdf',
        '.txt': 'text/plain'
      };
      mimetype = basicMimeMap[ext] || 'application/octet-stream';
    }
    
    const filesize = buffer.length;

    return new MessageMedia(mimetype, data, filename, filesize);
  }

  /**
   * Creates a MessageMedia instance from a buffer
   * @param {Buffer} buffer - File buffer
   * @param {string} mimetype - MIME type
   * @param {string} filename - File name
   * @returns {MessageMedia} MessageMedia instance
   */
  static fromBuffer(buffer, mimetype, filename) {
    const data = buffer.toString('base64');
    const filesize = buffer.length;
    return new MessageMedia(mimetype, data, filename, filesize);
  }

  /**
   * Creates a MessageMedia instance from a URL
   * @param {string} url - URL to download from
   * @param {Object} options - Download options
   * @returns {Promise<MessageMedia>} MessageMedia instance
   */
  static async fromUrl(url, options = {}) {
    const https = require('https');
    const http = require('http');
    const { URL } = require('url');
    const path = require('path');

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;

      const request = client.get(url, options, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const contentType = response.headers['content-type'];
          
          let mimetype = 'application/octet-stream';
          if (contentType) {
            mimetype = contentType.split(';')[0];
          } else {
            // Try mime-types if available, otherwise use basic detection
            try {
              const mime = require('mime-types');
              mimetype = mime.lookup(url) || 'application/octet-stream';
            } catch (e) {
              // Fallback to basic extension detection
              const ext = path.extname(parsedUrl.pathname).toLowerCase();
              const basicMimeMap = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.mp4': 'video/mp4',
                '.webm': 'video/webm',
                '.ogg': 'audio/ogg',
                '.mp3': 'audio/mpeg',
                '.pdf': 'application/pdf',
                '.txt': 'text/plain'
              };
              mimetype = basicMimeMap[ext] || 'application/octet-stream';
            }
          }
          
          const filename = options.filename || parsedUrl.pathname.split('/').pop() || 'download';
          
          resolve(MessageMedia.fromBuffer(buffer, mimetype, filename));
        });
      });

      request.on('error', reject);
      request.setTimeout(options.timeout || 30000, () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  /**
   * Saves the media to a file
   * @param {string} filePath - Path where to save the file
   * @returns {Promise<void>}
   */
  async save(filePath) {
    const fs = require('fs').promises;
    const path = require('path');

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Convert base64 to buffer and save
    const buffer = Buffer.from(this.data, 'base64');
    await fs.writeFile(filePath, buffer);
  }

  /**
   * Gets the file extension based on mimetype
   * @returns {string} File extension
   */
  getExtension() {
    if (!this.mimetype) return 'bin';

    // Try mime-types if available, otherwise use basic mapping
    try {
      const mime = require('mime-types');
      return mime.extension(this.mimetype) || this._getBasicExtension();
    } catch (e) {
      return this._getBasicExtension();
    }
  }

  /**
   * Gets basic file extension from mimetype
   * @private
   * @returns {string} File extension
   */
  _getBasicExtension() {
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/3gpp': '3gp',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
      'application/msword': 'doc',
      'application/vnd.ms-excel': 'xls',
      'application/vnd.ms-powerpoint': 'ppt',
      'text/plain': 'txt'
    };
    
    return mimeMap[this.mimetype] || 'bin';
  }

  /**
   * Validates the media data
   * @returns {boolean} True if valid
   */
  isValid() {
    return !!(this.mimetype && this.data && this.data.length > 0);
  }

  /**
   * Gets the actual file size from base64 data
   * @returns {number} File size in bytes
   */
  getActualSize() {
    if (!this.data) return 0;
    
    // Calculate actual size from base64 (accounting for padding)
    const padding = (this.data.match(/=/g) || []).length;
    return Math.floor((this.data.length * 3) / 4) - padding;
  }

  /**
   * Validates file integrity using hash
   * @param {string} expectedHash - Expected hash (base64)
   * @param {string} algorithm - Hash algorithm (default: sha256)
   * @returns {boolean} True if hash matches
   */
  validateIntegrity(expectedHash, algorithm = 'sha256') {
    if (!expectedHash || !this.data) return false;

    const crypto = require('crypto');
    const buffer = Buffer.from(this.data, 'base64');
    const hash = crypto.createHash(algorithm).update(buffer).digest('base64');
    
    return hash === expectedHash;
  }

  /**
   * Creates a thumbnail for image/video media
   * @param {Object} options - Thumbnail options
   * @returns {Promise<MessageMedia>} Thumbnail MessageMedia
   */
  async createThumbnail(options = {}) {
    // This would require image processing library like sharp
    // For now, return a placeholder implementation
    throw new Error('Thumbnail creation not implemented - requires image processing library');
  }

  /**
   * Converts the MessageMedia to a JSON object
   * @param {boolean} includeData - Whether to include base64 data
   * @returns {Object} JSON representation
   */
  toJSON(includeData = false) {
    const result = {
      mimetype: this.mimetype,
      filename: this.filename,
      filesize: this.filesize,
      actualSize: this.getActualSize(),
      extension: this.getExtension(),
      isValid: this.isValid()
    };

    if (includeData) {
      result.data = this.data;
    }

    return result;
  }

  /**
   * Creates a MessageMedia instance from JSON
   * @param {Object} json - JSON object
   * @returns {MessageMedia} MessageMedia instance
   */
  static fromJSON(json) {
    return new MessageMedia(
      json.mimetype,
      json.data,
      json.filename,
      json.filesize
    );
  }

  /**
   * Gets media type category
   * @returns {string} Media type (image, video, audio, document, etc.)
   */
  getMediaType() {
    if (!this.mimetype) return 'unknown';

    const type = this.mimetype.toLowerCase();
    
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (type.startsWith('text/')) return 'document';
    if (type.includes('pdf')) return 'document';
    if (type.includes('word') || type.includes('excel') || type.includes('powerpoint')) return 'document';
    if (type.includes('zip') || type.includes('rar') || type.includes('tar')) return 'document';
    
    return 'document';
  }

  /**
   * Checks if media is an image
   * @returns {boolean} True if image
   */
  isImage() {
    return this.getMediaType() === 'image';
  }

  /**
   * Checks if media is a video
   * @returns {boolean} True if video
   */
  isVideo() {
    return this.getMediaType() === 'video';
  }

  /**
   * Checks if media is audio
   * @returns {boolean} True if audio
   */
  isAudio() {
    return this.getMediaType() === 'audio';
  }

  /**
   * Checks if media is a document
   * @returns {boolean} True if document
   */
  isDocument() {
    return this.getMediaType() === 'document';
  }

  /**
   * Gets a human-readable file size
   * @returns {string} Formatted file size
   */
  getFormattedSize() {
    const size = this.filesize || this.getActualSize();
    
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  /**
   * Creates a data URL for the media
   * @returns {string} Data URL
   */
  toDataURL() {
    if (!this.data || !this.mimetype) {
      throw new Error('Invalid media data or mimetype');
    }
    
    return `data:${this.mimetype};base64,${this.data}`;
  }

  /**
   * Clones the MessageMedia instance
   * @returns {MessageMedia} Cloned instance
   */
  clone() {
    return new MessageMedia(this.mimetype, this.data, this.filename, this.filesize);
  }
}

module.exports = MessageMedia;