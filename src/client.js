/*
 Event Client
 - EventEmitter for all events
 - Routes events to NATS JetStream
 - Fallback to direct webhook if NATS unavailable
*/
const EventEmitter = require('events');
const Webhook = require('./webhook');
const Media = require('./media');

class Client extends EventEmitter {
  constructor({ webhook, media, storageDir, eventServer, natsPublisher }) {
    super();
    this.webhook = new Webhook(webhook);
    this.media = new Media({ mediaConfig: media, storageDir });
    this.eventServer = eventServer;
    this.webhookConfig = webhook;
    this.natsPublisher = natsPublisher;
  }

  async emitEvent(evt) {
    // Process event
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
    
    // Primary: Send to NATS JetStream
    if (this.natsPublisher) {
      const published = await this.natsPublisher.publishEvent(payload);
      
      if (!published) {
        // Fallback: Send directly to webhook if NATS failed
        console.log('[WRadar:client] NATS failed, falling back to direct webhook');
        if (this.webhookConfig && this.webhookConfig.enabled) {
          this.webhook.dispatch(payload).catch((err) => {
            console.log('[WRadar] Webhook fallback failed:', err.message);
          });
        }
      }
    } else {
      // No NATS: Send directly to webhook
      if (this.webhookConfig && this.webhookConfig.enabled) {
        this.webhook.dispatch(payload).catch((err) => {
          console.log('[WRadar] Webhook failed:', err.message);
        });
      }
    }
    
    // Emit for any other listeners
    this.emit('event', payload);
  }
}

module.exports = Client;
