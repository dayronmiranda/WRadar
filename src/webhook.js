/*
 Webhook Dispatcher
 - HTTP/HTTPS POST to configurable endpoint
 - Retry with exponential backoff
 - Timeout handling
*/
const http = require('http');
const https = require('https');
const { URL } = require('url');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Webhook {
  constructor({ enabled, port, endpoint, retries, protocol, url }) {
    this.enabled = enabled !== false;
    this.port = port || 3001;
    this.endpoint = endpoint || '/webhook';
    this.retries = typeof retries === 'number' ? retries : 3;
    this.protocol = protocol || 'http';
    this.url = url || 'localhost';
    this.timeoutMs = 5000;
    
    // Build full webhook URL - handle both full URLs and URL parts
    this.webhookUrl = this._buildWebhookUrl();
  }

  _buildWebhookUrl() {
    // If URL already contains protocol, use it as-is
    if (this.url.startsWith('http://') || this.url.startsWith('https://')) {
      return this.url;
    }
    
    // Otherwise, build URL from parts
    return `${this.protocol}://${this.url}:${this.port}${this.endpoint}`;
  }

  async dispatch(payload) {
    if (!this.enabled) return;
    const body = Buffer.from(JSON.stringify(payload));
    let attempt = 0;
    while (attempt <= this.retries) {
      try {
        await this._post(body);
        return;
      } catch (e) {
        if (attempt === this.retries) throw e;
        const backoff = Math.min(1000 * Math.pow(2, attempt), 10000);
        await sleep(backoff);
        attempt++;
      }
    }
  }

  _post(body) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(this.webhookUrl);
        const isHttps = parsedUrl.protocol === 'https:';
        const httpModule = isHttps ? https : http;
        
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            'User-Agent': 'WRadar/1.0'
          },
          timeout: this.timeoutMs,
        };

        // For HTTPS, disable certificate validation in development
        if (isHttps) {
          options.rejectUnauthorized = false;
        }

        const req = httpModule.request(options, (res) => {
          // Consume response data
          res.on('data', () => {});
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
            }
          });
        });

        req.on('timeout', () => { 
          req.destroy(new Error('Request timeout')); 
        });
        
        req.on('error', (err) => {
          reject(new Error(`Request failed: ${err.message}`));
        });

        req.write(body);
        req.end();
      } catch (e) {
        reject(new Error(`Invalid webhook URL: ${e.message}`));
      }
    });
  }

  // Get webhook info for debugging
  getInfo() {
    return {
      enabled: this.enabled,
      url: this.webhookUrl,
      retries: this.retries,
      timeout: this.timeoutMs
    };
  }
}

module.exports = Webhook;
