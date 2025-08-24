/*
 Media Download Queue
 - Manages media download requests
 - Interfaces with browser for actual downloads
 - Tracks download states
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
    this.stats = {
      processed: 0,
      downloaded: 0,
      errors: 0
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

    // Add to queue
    this.queue.push({
      messageId,
      rawData,
      timestamp: Date.now()
    });

    this.states.set(messageId, MEDIA_STATES.PENDING);
    console.log(`[MediaQueue] Enqueued ${rawData.type} media: ${messageId} (queue: ${this.queue.length})`);

    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }

    return true;
  }

  async processQueue() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    console.log(`[MediaQueue] Starting queue processing (${this.queue.length} items)`);

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      const { messageId, rawData } = item;

      try {
        // Set state to downloading
        this.states.set(messageId, MEDIA_STATES.DOWNLOADING);
        
        // Download media
        const result = await this.downloader.downloadMedia(messageId, rawData);
        
        if (result.success) {
          this.states.set(messageId, MEDIA_STATES.DOWNLOADED);
          this.stats.downloaded++;
          console.log(`[MediaQueue] Downloaded: ${result.fileName}`);
        } else {
          this.states.set(messageId, MEDIA_STATES.ERROR);
          this.stats.errors++;
          console.log(`[MediaQueue] Download failed: ${result.error}`);
        }

        this.stats.processed++;

        // Rate limiting - wait between downloads
        await this.sleep(1000);

      } catch (error) {
        console.log(`[MediaQueue] Processing error for ${messageId}: ${error.message}`);
        this.states.set(messageId, MEDIA_STATES.ERROR);
        this.stats.errors++;
        this.stats.processed++;
      }
    }

    this.processing = false;
    console.log(`[MediaQueue] Queue processing complete`);
  }

  getState(messageId) {
    return this.states.get(messageId) || MEDIA_STATES.PENDING;
  }

  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      processing: this.processing,
      totalStates: this.states.size
    };
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { MediaQueue, MEDIA_STATES };