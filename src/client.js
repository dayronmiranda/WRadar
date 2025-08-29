/*
 Event Client - Program A
 - EventEmitter for all events
 - Routes events to NATS JetStream staging
 - Media enrichment and processing
 - No direct webhook handling (Program B responsibility)
*/
const EventEmitter = require('events');
const { MediaManager } = require('./media/manager');

class Client extends EventEmitter {
  constructor({ media, storageDir, eventServer, natsPublisher, page }) {
    super();
    this.media = new MediaManager(page, storageDir, media);
    this.eventServer = eventServer;
    this.natsPublisher = natsPublisher;
  }

  async emitEvent(evt) {
    // Process event with media enrichment
    let payload = evt;
    try {
      payload = await this.media.maybeEnrich(evt);
    } catch (e) {
      payload = { ...evt, mediaError: String(e) };
    }
    
    // Send to internal event server (always works)
    if (this.eventServer) {
      this.eventServer.addEvent(payload);
      console.log(`[WRadar:client] Sent to server: ${payload.event}`);
    }
    
    // Send to NATS JetStream staging (Program A responsibility)
    if (this.natsPublisher) {
      const published = await this.natsPublisher.publishEvent(payload);
      
      if (!published) {
        console.log('[WRadar:client] ⚠️  NATS staging failed - event may be lost');
        console.log('[WRadar:client] Check NATS connection and Program B availability');
      } else {
        console.log(`[WRadar:client] Staged to NATS: ${payload.event}`);
      }
    } else {
      console.log('[WRadar:client] ⚠️  No NATS publisher - events not staged');
    }
    
    // Emit for any other listeners
    this.emit('event', payload);
  }
}

module.exports = Client;