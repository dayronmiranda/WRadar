/*
 NATS Webhook Consumer
 - Consumes events from NATS JetStream
 - Sends to external webhook with retry
 - Handles acknowledgments
*/
const Webhook = require('../../webhook');

class WebhookConsumer {
  constructor(natsClient, webhookConfig) {
    this.natsClient = natsClient;
    this.webhook = new Webhook(webhookConfig);
    this.consumer = null;
    this.running = false;
    this.processedCount = 0;
    this.errorCount = 0;
  }

  async start() {
    if (!this.natsClient.isConnected()) {
      console.log('[NATS:WebhookConsumer] NATS not connected, skipping');
      return false;
    }

    try {
      // Create consumer
      this.consumer = await this.natsClient.createConsumer(
        'webhook',
        this.natsClient.config.consumers.webhook
      );

      console.log('[NATS:WebhookConsumer] Starting webhook consumer...');
      this.running = true;

      // Start consuming
      this.consumeMessages();
      
      return true;
    } catch (error) {
      console.log(`[NATS:WebhookConsumer] Failed to start: ${error.message}`);
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
          
          // Send to webhook
          await this.webhook.dispatch(eventData);
          
          // Acknowledge message
          msg.ack();
          this.processedCount++;
          
          console.log(`[NATS:WebhookConsumer] Sent ${eventData.event} to webhook`);
          
        } catch (error) {
          console.log(`[NATS:WebhookConsumer] Error processing message: ${error.message}`);
          this.errorCount++;
          
          // Negative acknowledge - will be redelivered
          msg.nak();
        }
      }
    } catch (error) {
      console.log(`[NATS:WebhookConsumer] Consume error: ${error.message}`);
      
      // Restart consumption after delay
      if (this.running) {
        setTimeout(() => this.consumeMessages(), 5000);
      }
    }
  }

  async stop() {
    console.log('[NATS:WebhookConsumer] Stopping...');
    this.running = false;
    
    if (this.consumer) {
      try {
        await this.consumer.close();
      } catch (error) {
        console.log(`[NATS:WebhookConsumer] Error closing consumer: ${error.message}`);
      }
    }
  }

  getStats() {
    return {
      running: this.running,
      processed: this.processedCount,
      errors: this.errorCount,
      webhook: this.webhook.getInfo()
    };
  }
}

module.exports = WebhookConsumer;