/*
 Program B Health Checker
 - Detects if Program B is available and consuming from staging
 - Monitors staging queue depth
 - Provides operational guidance
*/
const http = require('http');
const https = require('https');
const { URL } = require('url');

class ProgramBChecker {
  constructor(natsClient, config = {}) {
    this.natsClient = natsClient;
    this.config = {
      healthEndpoint: config.healthEndpoint || 'http://localhost:3002/health',
      maxQueueDepth: config.maxQueueDepth || 1000,
      checkInterval: config.checkInterval || 30000, // 30 seconds
      timeout: config.timeout || 5000,
      ...config
    };
    
    this.lastCheck = null;
    this.isAvailable = false;
    this.queueDepth = 0;
    this.checkInterval = null;
    this.consecutiveFailures = 0;
  }

  async start() {
    console.log('[ProgramB:HealthChecker] Starting health monitoring...');
    
    // Initial check
    await this.performHealthCheck();
    
    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.performHealthCheck().catch(err => {
        console.log(`[ProgramB:HealthChecker] Scheduled check failed: ${err.message}`);
      });
    }, this.config.checkInterval);
    
    console.log(`[ProgramB:HealthChecker] Health monitoring started (interval: ${this.config.checkInterval}ms)`);
  }

  async stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[ProgramB:HealthChecker] Health monitoring stopped');
    }
  }

  async performHealthCheck() {
    this.lastCheck = Date.now();
    
    try {
      // Check 1: NATS consumer presence
      const consumerActive = await this.checkNatsConsumer();
      
      // Check 2: HTTP health endpoint
      const httpHealthy = await this.checkHttpHealth();
      
      // Check 3: Queue depth monitoring
      const queueStatus = await this.checkQueueDepth();
      
      const wasAvailable = this.isAvailable;
      this.isAvailable = consumerActive && httpHealthy && queueStatus.healthy;
      
      if (this.isAvailable) {
        this.consecutiveFailures = 0;
        if (!wasAvailable) {
          console.log('[ProgramB:HealthChecker] ✅ Program B is now available');
        }
      } else {
        this.consecutiveFailures++;
        if (wasAvailable) {
          console.log('[ProgramB:HealthChecker] ❌ Program B is no longer available');
        }
        
        // Log specific issues
        if (!consumerActive) {
          console.log('[ProgramB:HealthChecker] - NATS consumer not active on staging subject');
        }
        if (!httpHealthy) {
          console.log('[ProgramB:HealthChecker] - HTTP health endpoint not responding');
        }
        if (!queueStatus.healthy) {
          console.log(`[ProgramB:HealthChecker] - Queue depth too high: ${queueStatus.depth} messages`);
        }
      }
      
      // Warn about persistent failures
      if (this.consecutiveFailures >= 3) {
        console.log(`[ProgramB:HealthChecker] ⚠️  Program B unavailable for ${this.consecutiveFailures} consecutive checks`);
        console.log('[ProgramB:HealthChecker] Events will continue to be staged but may accumulate');
      }
      
    } catch (error) {
      console.log(`[ProgramB:HealthChecker] Health check failed: ${error.message}`);
      this.isAvailable = false;
      this.consecutiveFailures++;
    }
  }

  async checkNatsConsumer() {
    if (!this.natsClient || !this.natsClient.isConnected()) {
      return false;
    }

    try {
      // Check if there are active consumers on the staging subject
      const streamInfo = await this.natsClient.getStreamInfo();
      if (!streamInfo) {
        return false;
      }

      // Look for consumers that are filtering on staging subjects
      const consumers = streamInfo.state?.consumers || 0;
      return consumers > 0;
      
    } catch (error) {
      console.log(`[ProgramB:HealthChecker] NATS consumer check failed: ${error.message}`);
      return false;
    }
  }

  async checkHttpHealth() {
    return new Promise((resolve) => {
      try {
        const url = new URL(this.config.healthEndpoint);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'GET',
          timeout: this.config.timeout,
        };

        if (isHttps) {
          options.rejectUnauthorized = false;
        }

        const req = httpModule.request(options, (res) => {
          res.on('data', () => {}); // consume response
          res.on('end', () => {
            resolve(res.statusCode >= 200 && res.statusCode < 300);
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve(false);
        });

        req.on('error', () => {
          resolve(false);
        });

        req.end();
        
      } catch (error) {
        resolve(false);
      }
    });
  }

  async checkQueueDepth() {
    try {
      if (!this.natsClient || !this.natsClient.isConnected()) {
        return { healthy: true, depth: 0 };
      }

      const streamInfo = await this.natsClient.getStreamInfo();
      if (!streamInfo) {
        return { healthy: true, depth: 0 };
      }

      const depth = streamInfo.state?.messages || 0;
      this.queueDepth = depth;
      
      return {
        healthy: depth < this.config.maxQueueDepth,
        depth: depth
      };
      
    } catch (error) {
      console.log(`[ProgramB:HealthChecker] Queue depth check failed: ${error.message}`);
      return { healthy: true, depth: 0 };
    }
  }

  getStatus() {
    return {
      available: this.isAvailable,
      lastCheck: this.lastCheck,
      consecutiveFailures: this.consecutiveFailures,
      queueDepth: this.queueDepth,
      maxQueueDepth: this.config.maxQueueDepth,
      healthEndpoint: this.config.healthEndpoint
    };
  }

  // Quick synchronous check without performing new tests
  isCurrentlyAvailable() {
    return this.isAvailable;
  }
}

module.exports = ProgramBChecker;