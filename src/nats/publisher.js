/*
 NATS Publisher
 - Publishes WhatsApp events to JetStream
 - Handles deduplication via message ID
 - Fallback when NATS unavailable
*/

class NatsPublisher {
  constructor(natsClient) {
    this.natsClient = natsClient;
    this.subject = 'whatsapp.events';
  }

  async publishEvent(event) {
    if (!this.natsClient.isConnected()) {
      console.log('[NATS:Publisher] Not connected, skipping event');
      return false;
    }

    try {
      // Generate message ID for deduplication
      const msgID = this.generateMessageId(event);
      
      const pubAck = await this.natsClient.publish(this.subject, event, {
        msgID: msgID
      });

      console.log(`[NATS:Publisher] Published ${event.event} (seq: ${pubAck.seq})`);
      return true;
    } catch (error) {
      console.log(`[NATS:Publisher] Failed to publish ${event.event}: ${error.message}`);
      return false;
    }
  }

  generateMessageId(event) {
    // Create unique message ID for deduplication
    const timestamp = event.timestamp || Date.now();
    const eventType = event.event || 'unknown';
    
    // For messages, use WhatsApp message ID if available
    if (event.rawData && event.rawData.id && event.rawData.id._serialized) {
      return `${eventType}-${event.rawData.id._serialized}`;
    }
    
    // For other events, use timestamp + event type + hash of content
    const contentHash = this.simpleHash(JSON.stringify(event.rawData || {}));
    return `${eventType}-${timestamp}-${contentHash}`;
  }

  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  async getStats() {
    if (!this.natsClient.isConnected()) {
      return { connected: false };
    }

    try {
      const streamInfo = await this.natsClient.getStreamInfo();
      return {
        connected: true,
        stream: streamInfo ? {
          name: streamInfo.config.name,
          messages: streamInfo.state.messages,
          bytes: streamInfo.state.bytes,
          first_seq: streamInfo.state.first_seq,
          last_seq: streamInfo.state.last_seq
        } : null
      };
    } catch (error) {
      return { connected: true, error: error.message };
    }
  }
}

module.exports = NatsPublisher;