/*
 Event Client
 - EventEmitter for all events
 - Routes events to NATS
 - Media enrichment and processing
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

  updatePhoneNumber(phoneNumber) {
    if (this.natsPublisher) {
      this.natsPublisher.updatePhoneNumber(phoneNumber);
    }
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
    
    // Send to NATS
    if (this.natsPublisher) {
      const published = await this.natsPublisher.publishEvent(payload);
      
      if (!published) {
        console.log('[WRadar:client] ⚠️  NATS publish failed - event may be lost');
        console.log('[WRadar:client] Check NATS connection');
      } else {
        console.log(`[WRadar:client] Published to NATS: ${payload.event}`);
      }
    } else {
      console.log('[WRadar:client] ⚠️  No NATS publisher - events not published');
    }
    
    // Emit for any other listeners
    this.emit('event', payload);
  }
}

module.exports = Client;