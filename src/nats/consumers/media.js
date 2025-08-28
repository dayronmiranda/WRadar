/*
 NATS Media Consumer
 - Consumes events from NATS JetStream
 - Detects media in messages
 - Queues media for download using browser context
*/
const fs = require('fs');
const path = require('path');

// Media states
const MEDIA_STATES = {
  PENDING: 'pending',
  DOWNLOADING: 'downloading', 
  DOWNLOADED: 'downloaded',
  ERROR: 'error'
};

class MediaConsumer {
  constructor(natsClient, mediaConfig, storageDir, mediaQueue = null) {
    this.natsClient = natsClient;
    this.mediaConfig = mediaConfig;
    this.storageDir = storageDir;
    this.mediaQueue = mediaQueue;
    this.consumer = null;
    this.running = false;
    this.processedCount = 0;
    this.downloadedCount = 0;
    this.errorCount = 0;
    this.mediaStates = new Map(); // In-memory state tracking
  }

  async start() {
    if (!this.natsClient.isConnected() || !this.mediaConfig.enabled) {
      console.log('[NATS:MediaConsumer] Disabled or NATS not connected');
      return false;
    }

    try {
      // Ensure media directory exists
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      // Create consumer
      this.consumer = await this.natsClient.createConsumer(
        'media',
        this.natsClient.config.consumers.media
      );

      console.log('[NATS:MediaConsumer] Starting media consumer...');
      this.running = true;

      // Start consuming
      this.consumeMessages();
      
      return true;
    } catch (error) {
      console.log(`[NATS:MediaConsumer] Failed to start: ${error.message}`);
      return false;
    }
  }

  async consumeMessages() {
    if (!this.consumer) return;

    try {
      const messages = await this.consumer.consume();
      
      for await (const msg of messages) {
        if (!this.running) break;
        
        try {
          // Parse event
          const eventData = JSON.parse(msg.string());
          
          // Only process message events with media
          if (this.shouldProcessEvent(eventData)) {
            await this.processMediaEvent(eventData);
          }
          
          // Always acknowledge - we don't want to reprocess non-media events
          msg.ack();
          this.processedCount++;
          
        } catch (error) {
          console.log(`[NATS:MediaConsumer] Error processing message: ${error.message}`);
          this.errorCount++;
          msg.ack(); // Acknowledge to avoid infinite redelivery
        }
      }
    } catch (error) {
      console.log(`[NATS:MediaConsumer] Consume error: ${error.message}`);
      
      // Restart consumption after delay
      if (this.running) {
        setTimeout(() => this.consumeMessages(), 5000);
      }
    }
  }

  shouldProcessEvent(eventData) {
    // Only process message events
    if (!eventData.event || !eventData.event.startsWith('message_')) {
      return false;
    }

    // Check if message has media
    const rawData = eventData.rawData;
    if (!rawData || !rawData.type) {
      return false;
    }

    // Check if media type is in download list
    return this.mediaConfig.downloadTypes.includes(rawData.type);
  }

  async processMediaEvent(eventData) {
    const messageId = this.getMessageId(eventData);
    if (!messageId) {
      console.log('[NATS:MediaConsumer] No message ID found');
      return;
    }

    const rawData = eventData.rawData;

    // Check current state
    const currentState = this.mediaStates.get(messageId);
    if (currentState === MEDIA_STATES.DOWNLOADED || currentState === MEDIA_STATES.DOWNLOADING) {
      console.log(`[NATS:MediaConsumer] Message ${messageId} already ${currentState}`);
      return;
    }

    try {
      if (this.mediaQueue) {
        // Use media manager for browser-based downloads
        // MediaManager handles enqueueing internally via maybeEnrich
        const enrichedEvent = await this.mediaQueue.maybeEnrich({ rawData: rawData });
        if (enrichedEvent.localMedia && enrichedEvent.localMedia.queued) {
          this.mediaStates.set(messageId, MEDIA_STATES.PENDING);
          console.log(`[NATS:MediaConsumer] Queued ${rawData.type} for download: ${messageId}`);
        }
      } else {
        // Fallback: save metadata only
        await this.saveMetadataOnly(messageId, rawData);
        this.mediaStates.set(messageId, MEDIA_STATES.ERROR);
        console.log(`[NATS:MediaConsumer] No media queue available, saved metadata only: ${messageId}`);
      }
      
    } catch (error) {
      console.log(`[NATS:MediaConsumer] Processing failed for ${messageId}: ${error.message}`);
      this.mediaStates.set(messageId, MEDIA_STATES.ERROR);
      this.errorCount++;
    }
  }

  async saveMetadataOnly(messageId, rawData) {
    // Generate filename for metadata
    const timestamp = Date.now();
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    
    // Create year/month directory structure
    const yearDir = path.join(this.storageDir, year.toString());
    const monthDir = path.join(yearDir, month);
    
    if (!fs.existsSync(monthDir)) {
      fs.mkdirSync(monthDir, { recursive: true });
    }
    
    const metadataPath = path.join(monthDir, `${timestamp}_${messageId}.json`);
    
    const mediaMetadata = {
      messageId: messageId,
      timestamp: timestamp,
      type: rawData.type,
      mimetype: rawData.mimetype,
      size: rawData.size,
      downloadedAt: Date.now(),
      downloaded: false,
      error: 'No media queue available',
      sourceMeta: {
        mediaKey: rawData.mediaKey,
        mediaHash: rawData.filehash,
        directPath: rawData.directPath,
        clientUrl: rawData.clientUrl
      }
    };
    
    fs.writeFileSync(metadataPath, JSON.stringify(mediaMetadata, null, 2));
  }

  getMessageId(eventData) {
    if (eventData.rawData && eventData.rawData.id && eventData.rawData.id._serialized) {
      return eventData.rawData.id._serialized;
    }
    return null;
  }

  getMediaState(messageId) {
    if (this.mediaQueue) {
      return this.mediaQueue.getState(messageId);
    }
    return this.mediaStates.get(messageId) || MEDIA_STATES.PENDING;
  }

  async stop() {
    console.log('[NATS:MediaConsumer] Stopping...');
    this.running = false;
    
    if (this.consumer) {
      try {
        await this.consumer.close();
      } catch (error) {
        console.log(`[NATS:MediaConsumer] Error closing consumer: ${error.message}`);
      }
    }
  }

  getStats() {
    const baseStats = {
      running: this.running,
      processed: this.processedCount,
      errors: this.errorCount
    };

    if (this.mediaQueue) {
      const queueStats = this.mediaQueue.getStats();
      return {
        ...baseStats,
        downloaded: queueStats.downloaded,
        queueLength: queueStats.queueLength,
        processing: queueStats.processing
      };
    }

    return {
      ...baseStats,
      downloaded: this.downloadedCount,
      queueLength: 0,
      processing: false
    };
  }
}

module.exports = { MediaConsumer, MEDIA_STATES };