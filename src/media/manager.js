/*
 Unified Media Manager
 - Combines downloader, queue, and storage functionality
 - Handles media detection, validation, downloading, and storage
 - Provides circuit breaker, retry logic, and comprehensive state management
 - Enhanced with whatsapp-web.js compatible downloader
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MediaDownloader = require('./downloader');
const MessageMedia = require('./message-media');

// Media states
const MEDIA_STATES = {
  PENDING: 'pending',
  DOWNLOADING: 'downloading', 
  DOWNLOADED: 'downloaded',
  ERROR: 'error'
};

// Circuit breaker states
const CIRCUIT_BREAKER_STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

// Error types for categorization
const ERROR_TYPES = {
  VALIDATION: 'validation',
  DOWNLOAD: 'download',
  STORAGE: 'storage',
  BROWSER: 'browser',
  NETWORK: 'network',
  INTEGRITY: 'integrity'
};

class MediaManager {
  constructor(page, storageDir, config) {
    this.page = page;
    this.storageDir = storageDir;
    this.config = {
      enabled: true,
      downloadTypes: ['image', 'video', 'audio', 'document', 'sticker'],
      maxFileSize: '50MB',
      concurrentDownloads: 3,
      maxQueueSize: 1000,
      retryAttempts: 3,
      retryDelayMs: 5000,
      batchProcessSize: 10,
      allowedMimeTypes: [],
      enableDeduplication: true,
      enableIntegrityCheck: true,
      cleanupCompletedAfterMs: 24 * 60 * 60 * 1000, // 24 hours
      pauseOnHighMemoryMB: 1024,
      circuitBreakerThreshold: 10,
      circuitBreakerResetMs: 60000,
      ...config
    };

    // Initialize properties
    this.queue = [];
    this.states = new Map();
    this.activeDownloads = new Set();
    this.processing = false;
    this.deduplicationCache = new Map();
    
    // Statistics
    this.stats = {
      processed: 0,
      downloaded: 0,
      errors: 0,
      queued: 0,
      deduplicated: 0,
      retries: 0,
      circuitBreakerTrips: 0
    };

    // Circuit breaker
    this.circuitBreaker = {
      state: CIRCUIT_BREAKER_STATES.CLOSED,
      failures: 0,
      lastFailureTime: 0,
      successes: 0
    };

    // Initialize enhanced downloader
    this.downloader = new MediaDownloader(page, {
      retryAttempts: this.config.retryAttempts,
      retryDelayMs: this.config.retryDelayMs,
      enableIntegrityCheck: this.config.enableIntegrityCheck,
      enableDeduplication: this.config.enableDeduplication,
      maxFileSize: this._parseFileSize(this.config.maxFileSize),
      supportedTypes: this.config.downloadTypes
    });

    // Ensure storage directory exists
    this._ensureDir(this.storageDir);

    // Initialize downloader helpers
    this._initializeDownloader();
  }

  /**
   * Initialize the downloader with helper functions
   * @private
   */
  async _initializeDownloader() {
    try {
      await this.downloader.injectHelpers();
      console.log('[MediaManager] Enhanced downloader initialized');
    } catch (error) {
      console.log(`[MediaManager] Failed to initialize downloader: ${error.message}`);
    }
  }

  // Public API Methods

  async maybeEnrich(evt) {
    if (!this.config.enabled) return evt;
    
    const rawData = evt && evt.rawData;
    if (!rawData) return evt;

    const type = rawData.type || rawData.mediaType || rawData.mimetype;
    if (!type) return evt;

    // Validate media type
    if (!this._validateMediaType(type)) {
      return evt;
    }

    // Validate file size
    if (!this._validateFileSize(rawData.size)) {
      return evt;
    }

    // Validate MIME type
    if (!this._validateMimeType(rawData.mimetype)) {
      return evt;
    }

    // Check for media pointers
    const hasMediaPointer = rawData.mediaKey || rawData.mediaHash || 
                           rawData.clientUrl || rawData.directPath;
    if (!hasMediaPointer) {
      return evt;
    }

    // Get message ID
    const messageId = this._getMessageId(rawData);
    if (!messageId) {
      return evt;
    }

    // Check deduplication
    if (this.config.enableDeduplication && this._isDuplicate(messageId, rawData)) {
      this.stats.deduplicated++;
      return { ...evt, localMedia: { downloaded: false, deduplicated: true } };
    }

    // Enqueue for download
    const enqueued = await this._enqueue({
      messageId,
      rawData,
      timestamp: Date.now(),
      retries: 0
    });

    if (enqueued) {
      return { ...evt, localMedia: { queued: true, state: MEDIA_STATES.PENDING } };
    }

    return evt;
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      processing: this.processing,
      activeDownloads: this.activeDownloads.size,
      maxConcurrent: this.config.concurrentDownloads,
      totalStates: this.states.size,
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failures,
        successes: this.circuitBreaker.successes
      },
      deduplicationCacheSize: this.deduplicationCache.size
    };
  }

  getState(messageId) {
    return this.states.get(messageId) || null;
  }

  cleanup() {
    let cleaned = 0;
    const cutoffTime = Date.now() - this.config.cleanupCompletedAfterMs;
    
    for (const [messageId, state] of this.states.entries()) {
      if ((state.state === MEDIA_STATES.DOWNLOADED || state.state === MEDIA_STATES.ERROR) &&
          state.timestamp < cutoffTime) {
        this.states.delete(messageId);
        this.deduplicationCache.delete(messageId);
        cleaned++;
      }
    }
    
    console.log(`[MediaManager] Cleaned up ${cleaned} completed states`);
    return cleaned;
  }

  // Private Queue Methods

  async _enqueue(item) {
    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      console.log(`[MediaManager] Queue full (${this.config.maxQueueSize}), dropping item`);
      return false;
    }

    // Check circuit breaker
    if (!this._checkCircuitBreaker()) {
      console.log('[MediaManager] Circuit breaker open, dropping item');
      return false;
    }

    // Add to queue
    this.queue.push(item);
    this.states.set(item.messageId, {
      state: MEDIA_STATES.PENDING,
      timestamp: item.timestamp,
      messageId: item.messageId
    });
    
    this.stats.queued++;
    
    console.log(`[MediaManager] Enqueued ${item.rawData.type}: ${item.messageId} (queue: ${this.queue.length})`);

    // Start processing if not already running
    if (!this.processing) {
      this._processQueue();
    }

    return true;
  }

  async _processQueue() {
    if (this.processing) return;
    
    this.processing = true;
    console.log(`[MediaManager] Starting queue processing (max concurrent: ${this.config.concurrentDownloads})`);

    while (this.queue.length > 0 || this.activeDownloads.size > 0) {
      // Check memory usage
      if (this._isHighMemory()) {
        console.log('[MediaManager] High memory usage, pausing processing');
        await this._sleep(5000);
        continue;
      }

      // Process items in batches
      const batchSize = Math.min(this.config.batchProcessSize, this.queue.length);
      const batch = [];
      
      for (let i = 0; i < batchSize && this.activeDownloads.size < this.config.concurrentDownloads; i++) {
        if (this.queue.length === 0) break;
        batch.push(this.queue.shift());
      }

      // Start processing batch items
      for (const item of batch) {
        this._processItem(item);
      }

      // Wait before next iteration
      await this._sleep(100);
    }

    this.processing = false;
    console.log('[MediaManager] Queue processing complete');
  }

  async _processItem(item) {
    const { messageId, rawData } = item;
    
    // Add to active downloads
    this.activeDownloads.add(messageId);
    
    try {
      // Update state to downloading
      this.states.set(messageId, {
        state: MEDIA_STATES.DOWNLOADING,
        timestamp: Date.now(),
        messageId: messageId
      });
      
      console.log(`[MediaManager] Starting download: ${messageId} (${rawData.type})`);
      
      // Download media
      const result = await this._downloadMedia(messageId, rawData);
      
      if (result.success) {
        this.states.set(messageId, {
          state: MEDIA_STATES.DOWNLOADED,
          timestamp: Date.now(),
          messageId: messageId,
          result: result
        });
        
        this.stats.downloaded++;
        this._recordSuccess();
        
        console.log(`[MediaManager] Downloaded: ${result.fileName} (${result.size} bytes)`);
      } else {
        throw new Error(result.error || 'Download failed');
      }

    } catch (error) {
      console.log(`[MediaManager] Download failed for ${messageId}: ${error.message}`);
      
      // Handle retry logic
      if (item.retries < this.config.retryAttempts) {
        item.retries++;
        this.stats.retries++;
        
        console.log(`[MediaManager] Retrying download: ${messageId} (attempt ${item.retries + 1})`);
        
        // Add back to queue with exponential backoff
        setTimeout(() => {
          this.queue.push(item);
        }, this.config.retryDelayMs * Math.pow(2, item.retries - 1));
      } else {
        // Max retries reached
        this.states.set(messageId, {
          state: MEDIA_STATES.ERROR,
          timestamp: Date.now(),
          messageId: messageId,
          error: error.message
        });
        
        this.stats.errors++;
        this._recordFailure();
        
        // Save error metadata
        await this._saveErrorMetadata(messageId, error, rawData);
      }
    } finally {
      // Remove from active downloads
      this.activeDownloads.delete(messageId);
      this.stats.processed++;
    }
  }

  // Private Download Methods

  async _downloadMedia(messageId, rawData) {
    try {
      // Use the enhanced downloader to get MessageMedia object
      const messageMedia = await this.downloader.downloadMedia(rawData);
      
      if (!messageMedia) {
        throw new Error('Download failed - no media returned');
      }

      // Generate unique filename
      const fileName = this._generateUniqueFileName(messageId, rawData);
      const extension = messageMedia.getExtension();
      const fullFileName = `${fileName}.${extension}`;
      
      // Create directory structure (year/month)
      const timestamp = Date.now();
      const date = new Date(timestamp);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      
      const yearDir = path.join(this.storageDir, year.toString());
      const monthDir = path.join(yearDir, month);
      this._ensureDir(monthDir);
      
      const filePath = path.join(monthDir, fullFileName);
      
      // Save media file using MessageMedia's save method
      await messageMedia.save(filePath);
      
      // Create metadata
      const metadata = {
        messageId: messageId,
        timestamp: timestamp,
        type: rawData.type,
        mimetype: messageMedia.mimetype,
        size: messageMedia.getActualSize(),
        expectedSize: rawData.size,
        downloadedAt: Date.now(),
        filePath: filePath,
        fileName: fullFileName,
        downloaded: true,
        verified: !!(this.config.enableIntegrityCheck && rawData.filehash),
        sourceMeta: {
          mediaKey: rawData.mediaKey,
          mediaKeyTimestamp: rawData.mediaKeyTimestamp,
          mediaHash: rawData.filehash,
          encFilehash: rawData.encFilehash,
          directPath: rawData.directPath,
          clientUrl: rawData.clientUrl
        },
        messageMedia: messageMedia.toJSON(false) // Don't include data in metadata
      };
      
      // Save metadata
      await this._saveMetadata(filePath + '.json', metadata);
      
      return {
        success: true,
        fileName: fullFileName,
        filePath: filePath,
        metadata: metadata,
        size: messageMedia.getActualSize(),
        messageMedia: messageMedia
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  async _downloadFromBrowser(messageIdObj, rawData) {
    try {
      const downloadResult = await this.page.evaluate(async (msgIdObj, mediaInfo) => {
        try {
          // Enhanced WhatsApp Web media download implementation
          // Based on whatsapp-web.js approach
          
          // Check if Store is available
          if (!window.Store || !window.Store.Msg) {
            throw new Error('WhatsApp Store not available');
          }

          // Find message
          let message = null;
          if (msgIdObj && msgIdObj._serialized) {
            message = window.Store.Msg.get(msgIdObj._serialized);
          }
          
          if (!message) {
            throw new Error('Message not found in Store');
          }

          // Check if message has media
          if (!message.type || !['image', 'video', 'audio', 'document', 'sticker', 'ptt'].includes(message.type)) {
            throw new Error('Message does not contain downloadable media');
          }

          // Check media availability
          if (!message.mediaKey && !message.clientUrl && !message.directPath) {
            throw new Error('Message has no media download information');
          }
          
          // Check for expired status messages
          if (message.from && message.from._serialized === 'status@broadcast') {
            const messageAge = Date.now() - (message.t * 1000);
            if (messageAge > 24 * 60 * 60 * 1000) { // 24 hours
              throw new Error('Status message has expired (older than 24 hours)');
            }
          }

          // Download media using multiple methods (whatsapp-web.js approach)
          let mediaBlob = null;
          let downloadMethod = 'unknown';

          // Method 1: Use message's own downloadMedia method (preferred)
          if (message.downloadMedia && typeof message.downloadMedia === 'function') {
            try {
              mediaBlob = await message.downloadMedia({
                downloadEvenIfExpensive: true,
                rmrReason: 1
              });
              downloadMethod = 'message.downloadMedia';
            } catch (e) {
              console.log('[Browser] Method 1 failed:', e.message);
            }
          }

          // Method 2: Use Store.downloadMedia if available
          if (!mediaBlob && window.Store.downloadMedia && typeof window.Store.downloadMedia === 'function') {
            try {
              mediaBlob = await window.Store.downloadMedia(message, {
                downloadEvenIfExpensive: true,
                rmrReason: 1
              });
              downloadMethod = 'Store.downloadMedia';
            } catch (e) {
              console.log('[Browser] Method 2 failed:', e.message);
            }
          }

          // Method 3: Try without options
          if (!mediaBlob && message.downloadMedia) {
            try {
              mediaBlob = await message.downloadMedia();
              downloadMethod = 'message.downloadMedia (no options)';
            } catch (e) {
              console.log('[Browser] Method 3 failed:', e.message);
            }
          }

          // Method 4: Try Store without options
          if (!mediaBlob && window.Store.downloadMedia) {
            try {
              mediaBlob = await window.Store.downloadMedia(message);
              downloadMethod = 'Store.downloadMedia (no options)';
            } catch (e) {
              console.log('[Browser] Method 4 failed:', e.message);
            }
          }

          if (!mediaBlob) {
            throw new Error('All download methods failed - media may be expired or unavailable');
          }

          console.log('[Browser] Download successful using:', downloadMethod);

          // Convert to base64 (whatsapp-web.js approach)
          let base64Data = '';
          
          if (mediaBlob instanceof Blob) {
            // Handle Blob objects
            const arrayBuffer = await mediaBlob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            base64Data = btoa(String.fromCharCode.apply(null, uint8Array));
          } else if (mediaBlob instanceof ArrayBuffer) {
            // Handle ArrayBuffer objects
            const uint8Array = new Uint8Array(mediaBlob);
            base64Data = btoa(String.fromCharCode.apply(null, uint8Array));
          } else if (typeof mediaBlob === 'string') {
            // Handle string data
            if (mediaBlob.startsWith('data:')) {
              // Data URL format
              base64Data = mediaBlob.split(',')[1];
            } else {
              // Assume it's already base64
              base64Data = mediaBlob;
            }
          } else if (mediaBlob && mediaBlob.buffer) {
            // Handle objects with buffer property
            const uint8Array = new Uint8Array(mediaBlob.buffer);
            base64Data = btoa(String.fromCharCode.apply(null, uint8Array));
          } else {
            throw new Error('Unknown media blob format: ' + typeof mediaBlob);
          }

          if (!base64Data) {
            throw new Error('Failed to convert media to base64');
          }

          // Validate base64 data
          if (base64Data.length < 100) {
            throw new Error('Downloaded data seems too small, possibly corrupted');
          }

          return {
            success: true,
            data: base64Data,
            size: base64Data.length,
            method: downloadMethod,
            mediaType: message.type,
            mimetype: message.mimetype || 'unknown'
          };

        } catch (error) {
          return {
            success: false,
            error: error.message,
            messageType: msgIdObj ? 'found' : 'not_found',
            hasMediaKey: !!(msgIdObj && msgIdObj.mediaKey),
            hasDirectPath: !!(msgIdObj && msgIdObj.directPath)
          };
        }
      }, messageIdObj, rawData);

      return downloadResult;
    } catch (error) {
      console.log(`[MediaManager] Browser execution failed: ${error.message}`);
      return {
        success: false,
        error: `Browser execution failed: ${error.message}`
      };
    }
  }

  _verifyFileIntegrity(buffer, expectedHash) {
    try {
      const hash = crypto.createHash('sha256').update(buffer).digest('base64');
      return hash === expectedHash;
    } catch (error) {
      console.log(`[MediaManager] Hash verification failed: ${error.message}`);
      return false;
    }
  }

  // Private Utility Methods

  _getFileExtension(type, mimetype) {
    // Try mimetype first (more accurate)
    if (mimetype) {
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
      
      if (mimeMap[mimetype]) {
        return mimeMap[mimetype];
      }
    }
    
    // Fallback to type
    const typeMap = {
      'image': 'jpg',
      'video': 'mp4', 
      'audio': 'ogg',
      'document': 'pdf',
      'sticker': 'webp',
      'ptt': 'ogg'
    };
    
    return typeMap[type] || 'bin';
  }

  _sanitizeMessageId(messageId) {
    if (typeof messageId === 'object' && messageId._serialized) {
      return messageId._serialized.replace(/[^a-zA-Z0-9@._-]/g, '_');
    }
    return String(messageId).replace(/[^a-zA-Z0-9@._-]/g, '_');
  }

  _parseFileSize(sizeStr) {
    if (!sizeStr) return Infinity;
    const match = String(sizeStr).match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
    if (!match) return Infinity;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    const multipliers = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };
    
    return value * (multipliers[unit] || 1);
  }

  _generateUniqueFileName(messageId, rawData) {
    const timestamp = Date.now();
    const sanitizedId = this._sanitizeMessageId(messageId);
    return `${timestamp}_${sanitizedId}`;
  }

  _getMessageId(rawData) {
    if (rawData.id && rawData.id._serialized) {
      return rawData.id._serialized;
    }
    if (rawData.id && rawData.id.id) {
      return rawData.id.id;
    }
    if (rawData.id) {
      return String(rawData.id);
    }
    return null;
  }

  // Private Validation Methods

  _validateMediaType(type) {
    const typeStr = String(type).toLowerCase();
    return this.config.downloadTypes.some(allowedType => 
      typeStr.includes(allowedType.toLowerCase())
    );
  }

  _validateFileSize(size) {
    if (!size) return true;
    const maxBytes = this._parseFileSize(this.config.maxFileSize);
    return size <= maxBytes;
  }

  _validateMimeType(mimetype) {
    if (!this.config.allowedMimeTypes || this.config.allowedMimeTypes.length === 0) {
      return true;
    }
    return this.config.allowedMimeTypes.includes(mimetype);
  }

  // Private Circuit Breaker Methods

  _checkCircuitBreaker() {
    const now = Date.now();
    
    switch (this.circuitBreaker.state) {
      case CIRCUIT_BREAKER_STATES.CLOSED:
        return true;
        
      case CIRCUIT_BREAKER_STATES.OPEN:
        if (now - this.circuitBreaker.lastFailureTime >= this.config.circuitBreakerResetMs) {
          this.circuitBreaker.state = CIRCUIT_BREAKER_STATES.HALF_OPEN;
          console.log('[MediaManager] Circuit breaker half-open');
          return true;
        }
        return false;
        
      case CIRCUIT_BREAKER_STATES.HALF_OPEN:
        return true;
        
      default:
        return true;
    }
  }

  _recordSuccess() {
    this.circuitBreaker.successes++;
    this.circuitBreaker.failures = 0;
    
    if (this.circuitBreaker.state === CIRCUIT_BREAKER_STATES.HALF_OPEN) {
      this.circuitBreaker.state = CIRCUIT_BREAKER_STATES.CLOSED;
      console.log('[MediaManager] Circuit breaker closed');
    }
  }

  _recordFailure() {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    if (this.circuitBreaker.failures >= this.config.circuitBreakerThreshold) {
      this.circuitBreaker.state = CIRCUIT_BREAKER_STATES.OPEN;
      this.stats.circuitBreakerTrips++;
      console.log('[MediaManager] Circuit breaker opened');
    }
  }

  // Private Deduplication Methods

  _isDuplicate(messageId, rawData) {
    // Check if already processed
    if (this.states.has(messageId)) {
      return true;
    }
    
    // Check deduplication cache
    const deduplicationKey = this._generateDeduplicationKey(rawData);
    if (this.deduplicationCache.has(deduplicationKey)) {
      return true;
    }
    
    // Add to cache
    this.deduplicationCache.set(deduplicationKey, messageId);
    return false;
  }

  _generateDeduplicationKey(rawData) {
    // Create unique key based on media identifiers
    const keyParts = [
      rawData.mediaKey,
      rawData.mediaHash || rawData.filehash,
      rawData.directPath,
      rawData.size
    ].filter(Boolean);
    
    return keyParts.join('|');
  }

  // Private Storage Methods (integrated FileStorage functionality)

  _ensureDir(dir) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async _saveMetadata(filePath, metadata) {
    try {
      this._ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2));
    } catch (error) {
      console.log(`[MediaManager] Failed to save metadata: ${error.message}`);
    }
  }

  async _saveErrorMetadata(messageId, error, rawData) {
    try {
      const timestamp = Date.now();
      const errorMetadata = {
        messageId: messageId,
        timestamp: timestamp,
        type: rawData.type,
        mimetype: rawData.mimetype,
        downloaded: false,
        error: error.message,
        errorType: this._categorizeError(error),
        sourceMeta: {
          mediaKey: rawData.mediaKey,
          mediaKeyTimestamp: rawData.mediaKeyTimestamp,
          mediaHash: rawData.filehash,
          encFilehash: rawData.encFilehash,
          directPath: rawData.directPath,
          clientUrl: rawData.clientUrl
        }
      };
      
      const errorPath = path.join(this.storageDir, `error_${timestamp}_${this._sanitizeMessageId(messageId)}.json`);
      await this._saveMetadata(errorPath, errorMetadata);
    } catch (saveError) {
      console.log(`[MediaManager] Failed to save error metadata: ${saveError.message}`);
    }
  }

  _categorizeError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('validation') || message.includes('invalid')) {
      return ERROR_TYPES.VALIDATION;
    }
    if (message.includes('browser') || message.includes('store')) {
      return ERROR_TYPES.BROWSER;
    }
    if (message.includes('network') || message.includes('timeout')) {
      return ERROR_TYPES.NETWORK;
    }
    if (message.includes('integrity') || message.includes('hash')) {
      return ERROR_TYPES.INTEGRITY;
    }
    if (message.includes('storage') || message.includes('file')) {
      return ERROR_TYPES.STORAGE;
    }
    
    return ERROR_TYPES.DOWNLOAD;
  }

  // Private Helper Methods

  _isHighMemory() {
    if (!this.config.pauseOnHighMemoryMB) return false;
    
    try {
      const memUsage = process.memoryUsage();
      const memUsageMB = memUsage.heapUsed / 1024 / 1024;
      return memUsageMB > this.config.pauseOnHighMemoryMB;
    } catch (error) {
      return false;
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { MediaManager, MEDIA_STATES, CIRCUIT_BREAKER_STATES, ERROR_TYPES };