/*
 Media Downloader - Enhanced version based on whatsapp-web.js approach
 - Implements multiple download strategies
 - Handles different message types and media formats
 - Provides robust error handling and retry logic
 - Supports integrity verification and deduplication
*/

const MessageMedia = require('./message-media');
const crypto = require('crypto');

class MediaDownloader {
  constructor(page, config = {}) {
    this.page = page;
    this.config = {
      retryAttempts: 3,
      retryDelayMs: 2000,
      downloadTimeout: 60000,
      enableIntegrityCheck: true,
      enableDeduplication: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      supportedTypes: ['image', 'video', 'audio', 'document', 'sticker', 'ptt'],
      ...config
    };

    // Cache for deduplication
    this.downloadCache = new Map();
    
    // Statistics
    this.stats = {
      downloads: 0,
      successes: 0,
      failures: 0,
      retries: 0,
      cached: 0,
      integrityChecks: 0,
      integrityFailures: 0
    };
  }

  /**
   * Downloads media from a WhatsApp message
   * @param {Object} message - Message object with media information
   * @param {Object} options - Download options
   * @returns {Promise<MessageMedia|null>} Downloaded media or null if failed
   */
  async downloadMedia(message, options = {}) {
    this.stats.downloads++;

    try {
      // Validate message
      if (!this._validateMessage(message)) {
        throw new Error('Invalid message or no media content');
      }

      // Check deduplication
      if (this.config.enableDeduplication) {
        const cached = this._checkCache(message);
        if (cached) {
          this.stats.cached++;
          return cached;
        }
      }

      // Check file size limits
      if (message.size && message.size > this.config.maxFileSize) {
        throw new Error(`File size (${message.size}) exceeds maximum allowed (${this.config.maxFileSize})`);
      }

      // Check if message is expired (for status messages)
      if (this._isExpiredStatus(message)) {
        throw new Error('Status message has expired (older than 24 hours)');
      }

      // Download with retry logic
      let lastError;
      for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
        try {
          const media = await this._attemptDownload(message, options, attempt);
          
          if (media) {
            // Verify integrity if enabled and hash available
            if (this.config.enableIntegrityCheck && message.filehash) {
              this.stats.integrityChecks++;
              if (!media.validateIntegrity(message.filehash)) {
                this.stats.integrityFailures++;
                throw new Error('File integrity check failed - hash mismatch');
              }
            }

            // Cache successful download
            if (this.config.enableDeduplication) {
              this._cacheResult(message, media);
            }

            this.stats.successes++;
            return media;
          }
        } catch (error) {
          lastError = error;
          
          if (attempt < this.config.retryAttempts) {
            this.stats.retries++;
            console.log(`[MediaDownloader] Attempt ${attempt} failed: ${error.message}, retrying...`);
            
            // Exponential backoff
            const delay = this.config.retryDelayMs * Math.pow(2, attempt - 1);
            await this._sleep(delay);
          }
        }
      }

      // All attempts failed
      this.stats.failures++;
      throw lastError || new Error('Download failed after all retry attempts');

    } catch (error) {
      this.stats.failures++;
      console.log(`[MediaDownloader] Download failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Attempts to download media using multiple strategies
   * @private
   */
  async _attemptDownload(message, options, attempt) {
    const strategies = [
      () => this._downloadUsingMessageMethod(message, options),
      () => this._downloadUsingStoreMethod(message, options),
      () => this._downloadUsingDirectMethod(message, options),
      () => this._downloadUsingFallbackMethod(message, options)
    ];

    // Try different strategies based on attempt number
    const strategyIndex = (attempt - 1) % strategies.length;
    const strategy = strategies[strategyIndex];

    console.log(`[MediaDownloader] Attempt ${attempt}: Using strategy ${strategyIndex + 1}`);
    
    const downloadResult = await strategy();
    
    // Convert the download result to MessageMedia instance
    return this._createMessageMedia(downloadResult);
  }

  /**
   * Download using message's own downloadMedia method (preferred)
   * @private
   */
  async _downloadUsingMessageMethod(message, options) {
    return await this.page.evaluate(async (msgId, downloadOptions) => {
      try {
        // Find message in Store
        if (!window.Store || !window.Store.Msg) {
          throw new Error('WhatsApp Store not available');
        }

        const msg = window.Store.Msg.get(msgId);
        if (!msg) {
          throw new Error('Message not found in Store');
        }

        // Check if message has downloadMedia method
        if (!msg.downloadMedia || typeof msg.downloadMedia !== 'function') {
          throw new Error('Message does not have downloadMedia method');
        }

        // Download media
        const mediaBlob = await msg.downloadMedia({
          downloadEvenIfExpensive: true,
          rmrReason: 1,
          ...downloadOptions
        });

        if (!mediaBlob) {
          throw new Error('Download returned empty result');
        }

        // Convert to base64
        const base64Data = await window.MediaDownloader._convertBlobToBase64(mediaBlob);
        
        return {
          success: true,
          data: base64Data,
          mimetype: msg.mimetype || 'application/octet-stream',
          filename: msg.filename || msg.caption || 'media',
          filesize: msg.size || base64Data.length,
          method: 'message.downloadMedia'
        };

      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }, message.id._serialized || message.id, options);
  }

  /**
   * Download using Store.downloadMedia method
   * @private
   */
  async _downloadUsingStoreMethod(message, options) {
    return await this.page.evaluate(async (msgId, downloadOptions) => {
      try {
        if (!window.Store || !window.Store.downloadMedia) {
          throw new Error('Store.downloadMedia not available');
        }

        const msg = window.Store.Msg.get(msgId);
        if (!msg) {
          throw new Error('Message not found in Store');
        }

        const mediaBlob = await window.Store.downloadMedia(msg, {
          downloadEvenIfExpensive: true,
          rmrReason: 1,
          ...downloadOptions
        });

        if (!mediaBlob) {
          throw new Error('Store download returned empty result');
        }

        const base64Data = await window.MediaDownloader._convertBlobToBase64(mediaBlob);
        
        return {
          success: true,
          data: base64Data,
          mimetype: msg.mimetype || 'application/octet-stream',
          filename: msg.filename || msg.caption || 'media',
          filesize: msg.size || base64Data.length,
          method: 'Store.downloadMedia'
        };

      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }, message.id._serialized || message.id, options);
  }

  /**
   * Download using direct media URL access
   * @private
   */
  async _downloadUsingDirectMethod(message, options) {
    return await this.page.evaluate(async (msgId, downloadOptions) => {
      try {
        const msg = window.Store.Msg.get(msgId);
        if (!msg) {
          throw new Error('Message not found in Store');
        }

        // Try to get direct URL
        let mediaUrl = null;
        if (msg.clientUrl) {
          mediaUrl = msg.clientUrl;
        } else if (msg.directPath) {
          // Construct URL from directPath
          mediaUrl = `https://mmg.whatsapp.net${msg.directPath}`;
        }

        if (!mediaUrl) {
          throw new Error('No direct media URL available');
        }

        // Fetch media directly
        const response = await fetch(mediaUrl, {
          method: 'GET',
          headers: {
            'User-Agent': navigator.userAgent
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const base64Data = btoa(String.fromCharCode.apply(null, uint8Array));

        return {
          success: true,
          data: base64Data,
          mimetype: msg.mimetype || response.headers.get('content-type') || 'application/octet-stream',
          filename: msg.filename || msg.caption || 'media',
          filesize: msg.size || arrayBuffer.byteLength,
          method: 'direct_url'
        };

      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }, message.id._serialized || message.id, options);
  }

  /**
   * Fallback download method using various approaches
   * @private
   */
  async _downloadUsingFallbackMethod(message, options) {
    return await this.page.evaluate(async (msgId, downloadOptions) => {
      try {
        const msg = window.Store.Msg.get(msgId);
        if (!msg) {
          throw new Error('Message not found in Store');
        }

        // Try different fallback approaches
        let mediaBlob = null;

        // Approach 1: Try prototype method
        if (msg.constructor && msg.constructor.prototype && msg.constructor.prototype.downloadMedia) {
          try {
            mediaBlob = await msg.constructor.prototype.downloadMedia.call(msg, downloadOptions);
          } catch (e) {
            console.log('[Fallback] Prototype method failed:', e.message);
          }
        }

        // Approach 2: Try without options
        if (!mediaBlob && msg.downloadMedia) {
          try {
            mediaBlob = await msg.downloadMedia();
          } catch (e) {
            console.log('[Fallback] No options method failed:', e.message);
          }
        }

        // Approach 3: Try Store without options
        if (!mediaBlob && window.Store.downloadMedia) {
          try {
            mediaBlob = await window.Store.downloadMedia(msg);
          } catch (e) {
            console.log('[Fallback] Store no options method failed:', e.message);
          }
        }

        if (!mediaBlob) {
          throw new Error('All fallback methods failed');
        }

        const base64Data = await window.MediaDownloader._convertBlobToBase64(mediaBlob);
        
        return {
          success: true,
          data: base64Data,
          mimetype: msg.mimetype || 'application/octet-stream',
          filename: msg.filename || msg.caption || 'media',
          filesize: msg.size || base64Data.length,
          method: 'fallback'
        };

      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }, message.id._serialized || message.id, options);
  }

  /**
   * Injects helper functions into the page context
   */
  async injectHelpers() {
    await this.page.evaluateOnNewDocument(() => {
      // Helper functions for media conversion
      window.MediaDownloader = {
        async _convertBlobToBase64(blob) {
          if (blob instanceof Blob) {
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            return btoa(String.fromCharCode.apply(null, uint8Array));
          } else if (blob instanceof ArrayBuffer) {
            const uint8Array = new Uint8Array(blob);
            return btoa(String.fromCharCode.apply(null, uint8Array));
          } else if (typeof blob === 'string') {
            if (blob.startsWith('data:')) {
              return blob.split(',')[1];
            }
            return blob;
          } else if (blob && blob.buffer) {
            const uint8Array = new Uint8Array(blob.buffer);
            return btoa(String.fromCharCode.apply(null, uint8Array));
          } else {
            throw new Error('Unknown blob format: ' + typeof blob);
          }
        }
      };
    });
  }

  /**
   * Validates if a message contains downloadable media
   * @private
   */
  _validateMessage(message) {
    if (!message || !message.id) {
      return false;
    }

    // Check if message has media type
    if (!message.type || !this.config.supportedTypes.includes(message.type)) {
      return false;
    }

    // Check if message has media identifiers
    const hasMediaKey = !!(message.mediaKey);
    const hasDirectPath = !!(message.directPath);
    const hasClientUrl = !!(message.clientUrl);

    return hasMediaKey || hasDirectPath || hasClientUrl;
  }

  /**
   * Checks if a status message has expired
   * @private
   */
  _isExpiredStatus(message) {
    if (!message.from || message.from._serialized !== 'status@broadcast') {
      return false;
    }

    const messageAge = Date.now() - (message.t * 1000);
    return messageAge > 24 * 60 * 60 * 1000; // 24 hours
  }

  /**
   * Checks cache for previously downloaded media
   * @private
   */
  _checkCache(message) {
    if (!this.config.enableDeduplication) {
      return null;
    }

    const cacheKey = this._generateCacheKey(message);
    return this.downloadCache.get(cacheKey) || null;
  }

  /**
   * Caches successful download result
   * @private
   */
  _cacheResult(message, media) {
    if (!this.config.enableDeduplication) {
      return;
    }

    const cacheKey = this._generateCacheKey(message);
    this.downloadCache.set(cacheKey, media);

    // Limit cache size
    if (this.downloadCache.size > 1000) {
      const firstKey = this.downloadCache.keys().next().value;
      this.downloadCache.delete(firstKey);
    }
  }

  /**
   * Generates cache key for deduplication
   * @private
   */
  _generateCacheKey(message) {
    const keyParts = [
      message.mediaKey,
      message.filehash,
      message.directPath,
      message.size
    ].filter(Boolean);

    return crypto.createHash('md5').update(keyParts.join('|')).digest('hex');
  }

  /**
   * Sleep utility
   * @private
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Gets download statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheSize: this.downloadCache.size,
      successRate: this.stats.downloads > 0 ? (this.stats.successes / this.stats.downloads * 100).toFixed(2) + '%' : '0%',
      integritySuccessRate: this.stats.integrityChecks > 0 ? ((this.stats.integrityChecks - this.stats.integrityFailures) / this.stats.integrityChecks * 100).toFixed(2) + '%' : '0%'
    };
  }

  /**
   * Clears the download cache
   */
  clearCache() {
    const size = this.downloadCache.size;
    this.downloadCache.clear();
    console.log(`[MediaDownloader] Cleared cache (${size} entries)`);
    return size;
  }

  /**
   * Creates a MessageMedia instance from download result
   * @private
   */
  _createMessageMedia(downloadResult) {
    if (!downloadResult || !downloadResult.success) {
      return null;
    }

    return new MessageMedia(
      downloadResult.mimetype,
      downloadResult.data,
      downloadResult.filename,
      downloadResult.filesize
    );
  }
}

module.exports = MediaDownloader;