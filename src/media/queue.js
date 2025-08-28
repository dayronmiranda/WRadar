/*
 Media Download Queue
 - Manages media download requests with real concurrency
 - Interfaces with browser for actual downloads
 - Tracks download states with proper concurrency control
*/
const MediaDownloader = require('./downloader');

// Media states
const MEDIA_STATES = {
  PENDING: 'pending',
  DOWNLOADING: 'downloading', 
  DOWNLOADED: 'downloaded',
  ERROR: 'error'
};

class MediaQueue {
  constructor(page, storageDir, config) {
    this.page = page;
    this.storageDir = storageDir;
    this.config = config;
    this.downloader = new MediaDownloader(page, storageDir);
    this.queue = [];
    this.processing = false;
    this.states = new Map();
    this.activeDownloads = new Set();
    this.maxConcurrent = config.concurrentDownloads || 3;
    this.stats = {
      processed: 0,
      downloaded: 0,
      errors: 0,
      queued: 0
    };
  }

  async enqueue(messageId, rawData) {
    // Check if already processed or in queue
    const currentState = this.states.get(messageId);
    if (currentState === MEDIA_STATES.DOWNLOADED || currentState === MEDIA_STATES.DOWNLOADING) {
      console.log(`[MediaQueue] Message ${messageId} already ${currentState}`);
      return false;
    }

    // Check if media type is supported
    if (!this.config.downloadTypes.includes(rawData.type)) {
      console.log(`[MediaQueue] Media type ${rawData.type} not in download list`);
      return false;
    }

    // Check file size limit
    if (rawData.size && this.config.maxFileSize) {
      const maxBytes = this.parseFileSize(this.config.maxFileSize);
      if (rawData.size > maxBytes) {
        console.log(`[MediaQueue] File too large: ${rawData.size} > ${maxBytes} bytes`);
        this.states.set(messageId, MEDIA_STATES.ERROR);
        return false;
      }
    }

    // Add to queue
    this.queue.push({
      messageId,
      rawData,
      timestamp: Date.now(),
      retries: 0
    });

    this.states.set(messageId, MEDIA_STATES.PENDING);
    this.stats.queued++;
    
    console.log(`[MediaQueue] Enqueued ${rawData.type} media: ${messageId} (queue: ${this.queue.length})`);

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }

    return true;
  }

  async processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;
    console.log(`[MediaQueue] Starting concurrent queue processing (max: ${this.maxConcurrent})`);

    while (this.queue.length > 0 || this.activeDownloads.size > 0) {
      // Start new downloads up to the concurrent limit
      while (this.queue.length > 0 && this.activeDownloads.size < this.maxConcurrent) {
        const item = this.queue.shift();
        this.processItem(item);
      }

      // Wait a bit before checking again
      await this.sleep(100);
    }

    this.processing = false;
    console.log(`[MediaQueue] Queue processing complete`);
  }

  async processItem(item) {
    const { messageId, rawData } = item;
    
    // Add to active downloads
    this.activeDownloads.add(messageId);
    
    try {
      // Set state to downloading
      this.states.set(messageId, MEDIA_STATES.DOWNLOADING);
      
      console.log(`[MediaQueue] Starting download: ${messageId} (${rawData.type})`);
      
      // Download media
      const result = await this.downloader.downloadMedia(messageId, rawData);
      
      if (result.success) {
        this.states.set(messageId, MEDIA_STATES.DOWNLOADED);
        this.stats.downloaded++;
        console.log(`[MediaQueue] Downloaded: ${result.fileName} (${result.size} bytes)`);
      } else {
        this.states.set(messageId, MEDIA_STATES.ERROR);
        this.stats.errors++;
        console.log(`[MediaQueue] Download failed: ${result.error}`);
        
        // Retry logic
        if (item.retries < 2) { // Max 2 retries
          item.retries++;
          console.log(`[MediaQueue] Retrying download: ${messageId} (attempt ${item.retries + 1})`);
          
          // Add back to queue with delay
          setTimeout(() => {
            this.queue.push(item);
          }, 5000 * item.retries); // Exponential backoff
        }
      }

      this.stats.processed++;

    } catch (error) {
      console.log(`[MediaQueue] Processing error for ${messageId}: ${error.message}`);
      this.states.set(messageId, MEDIA_STATES.ERROR);
      this.stats.errors++;
      this.stats.processed++;
    } finally {
      // Remove from active downloads
      this.activeDownloads.delete(messageId);
    }
  }

  parseFileSize(sizeStr) {
    // Parse size strings like "50MB", "1GB", etc.
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i);
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

  getState(messageId) {
    return this.states.get(messageId) || MEDIA_STATES.PENDING;
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      processing: this.processing,
      activeDownloads: this.activeDownloads.size,
      maxConcurrent: this.maxConcurrent,
      totalStates: this.states.size
    };
  }

  // Get detailed queue status
  getQueueStatus() {
    const statusByState = {
      [MEDIA_STATES.PENDING]: 0,
      [MEDIA_STATES.DOWNLOADING]: 0,
      [MEDIA_STATES.DOWNLOADED]: 0,
      [MEDIA_STATES.ERROR]: 0
    };

    for (const state of this.states.values()) {
      statusByState[state]++;
    }

    return {
      ...statusByState,
      queueLength: this.queue.length,
      activeDownloads: Array.from(this.activeDownloads),
      processing: this.processing
    };
  }

  // Clear completed and error states (cleanup)
  cleanup() {
    let cleaned = 0;
    for (const [messageId, state] of this.states.entries()) {
      if (state === MEDIA_STATES.DOWNLOADED || state === MEDIA_STATES.ERROR) {
        this.states.delete(messageId);
        cleaned++;
      }
    }
    console.log(`[MediaQueue] Cleaned up ${cleaned} completed states`);
    return cleaned;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { MediaQueue, MEDIA_STATES };