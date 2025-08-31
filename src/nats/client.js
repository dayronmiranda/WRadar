/*
 NATS JetStream Client
 - Connection management
 - Stream and consumer setup
 - Graceful shutdown
*/
const { connect, StringCodec, AckPolicy, RetentionPolicy } = require('nats');

class NatsClient {
  constructor(config) {
    this.config = config;
    this.nc = null;
    this.js = null;
    this.jsm = null;
    this.sc = StringCodec();
    this.connected = false;
  }

  async connect() {
    if (!this.config.enabled) {
      console.log('[NATS] Disabled in config');
      return false;
    }

    try {
      console.log(`[NATS] Connecting to ${this.config.url}...`);
      this.nc = await connect({ servers: this.config.url });
      this.js = this.nc.jetstream();
      this.jsm = await this.nc.jetstreamManager();
      this.connected = true;
      
      console.log('[NATS] Connected successfully');
      
      // Setup stream
      await this.setupStream();
      
      return true;
    } catch (error) {
      console.log(`[NATS] Connection failed: ${error.message}`);
      this.connected = false;
      return false;
    }
  }

  async setupStream() {
    try {
      const streamConfig = {
        name: this.config.stream.name,
        subjects: this.config.stream.subjects,
        retention: RetentionPolicy.Limits,
        max_age: this.parseMaxAge(this.config.stream.max_age),
        max_msgs: this.config.stream.max_msgs,
        duplicate_window: this.parseDuration(this.config.stream.duplicate_window)
      };

      // Try to get existing stream
      try {
        const stream = await this.jsm.streams.info(streamConfig.name);
        console.log(`[NATS] Stream '${streamConfig.name}' already exists`);
      } catch (err) {
        // Stream doesn't exist, create it
        await this.jsm.streams.add(streamConfig);
        console.log(`[NATS] Created stream '${streamConfig.name}'`);
      }
    } catch (error) {
      console.log(`[NATS] Stream setup failed: ${error.message}`);
      throw error;
    }
  }

  async publish(subject, data, options = {}) {
    if (!this.connected || !this.js) {
      throw new Error('NATS not connected');
    }

    try {
      const payload = this.sc.encode(JSON.stringify(data));
      const pubAck = await this.js.publish(subject, payload, {
        msgID: options.msgID,
        headers: options.headers
      });
      
      return pubAck;
    } catch (error) {
      console.log(`[NATS] Publish failed: ${error.code || error.message}`);
      
      // If it's a connection issue, mark as disconnected
      if (error.code === '503' || error.message.includes('503') || error.message.includes('connection')) {
        this.connected = false;
      }
      
      throw error;
    }
  }

  async createConsumer(consumerName, config) {
    if (!this.connected || !this.jsm) {
      throw new Error('NATS not connected');
    }

    try {
      const consumerConfig = {
        durable_name: config.durable_name,
        ack_policy: AckPolicy.Explicit,
        max_deliver: config.max_deliver || 3,
        ack_wait: this.parseDuration(config.ack_wait || '30s'),
        filter_subject: 'whatsapp.events'
      };

      // Try to get existing consumer
      try {
        const consumer = await this.jsm.consumers.info(this.config.stream.name, consumerConfig.durable_name);
        console.log(`[NATS] Consumer '${consumerConfig.durable_name}' already exists`);
      } catch (err) {
        // Consumer doesn't exist, create it
        await this.jsm.consumers.add(this.config.stream.name, consumerConfig);
        console.log(`[NATS] Created consumer '${consumerConfig.durable_name}'`);
      }

      return this.js.consumers.get(this.config.stream.name, consumerConfig.durable_name);
    } catch (error) {
      console.log(`[NATS] Consumer creation failed: ${error.message}`);
      throw error;
    }
  }

  async getStreamInfo() {
    if (!this.connected || !this.jsm) {
      return null;
    }

    try {
      return await this.jsm.streams.info(this.config.stream.name);
    } catch (error) {
      return null;
    }
  }

  parseDuration(duration) {
    // Convert duration strings like "30s", "2m", "1h" to nanoseconds
    const match = duration.match(/^(\d+)([smh])$/);
    if (!match) return 30 * 1000 * 1000000; // default 30s in nanoseconds
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 's': return value * 1000 * 1000000; // seconds to nanoseconds
      case 'm': return value * 60 * 1000 * 1000000; // minutes to nanoseconds  
      case 'h': return value * 60 * 60 * 1000 * 1000000; // hours to nanoseconds
      default: return 30 * 1000 * 1000000;
    }
  }

  parseMaxAge(maxAge) {
    // Convert duration strings like "7d", "24h" to nanoseconds
    const match = maxAge.match(/^(\d+)([dhm])$/);
    if (!match) return 7 * 24 * 60 * 60 * 1000 * 1000000; // default 7 days
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    switch (unit) {
      case 'd': return value * 24 * 60 * 60 * 1000 * 1000000; // days to nanoseconds
      case 'h': return value * 60 * 60 * 1000 * 1000000; // hours to nanoseconds
      case 'm': return value * 60 * 1000 * 1000000; // minutes to nanoseconds
      default: return 7 * 24 * 60 * 60 * 1000 * 1000000;
    }
  }

  async close() {
    if (this.nc) {
      console.log('[NATS] Closing connection...');
      await this.nc.close();
      this.connected = false;
      console.log('[NATS] Connection closed');
    }
  }

  isConnected() {
    return this.connected && this.nc && !this.nc.isClosed();
  }
}

module.exports = NatsClient;