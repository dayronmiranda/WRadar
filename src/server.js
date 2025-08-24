/*
 Simple HTTP Server to display raw event captures
 - Shows events in real-time via Server-Sent Events
 - Web interface at http://localhost:3001
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

class EventServer {
  constructor(port = 3001) {
    this.port = port;
    this.clients = new Set();
    this.events = [];
    this.maxEvents = 100; // Keep last 100 events
    this.server = null;
  }

  start() {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      
      if (url.pathname === '/') {
        this.serveHTML(res);
      } else if (url.pathname === '/events') {
        this.serveSSE(req, res);
      } else if (url.pathname === '/webhook' && req.method === 'POST') {
        this.handleWebhook(req, res);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(this.port, () => {
      console.log(`[WRadar:server] Event viewer at http://localhost:${this.port}`);
    });
  }

  serveHTML(res) {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>WRadar - Event Monitor</title>
  <style>
    body { font-family: monospace; margin: 20px; background: #1a1a1a; color: #00ff00; }
    .header { color: #ffff00; margin-bottom: 20px; }
    .event { border: 1px solid #333; margin: 10px 0; padding: 10px; background: #2a2a2a; }
    .event-type { color: #00ffff; font-weight: bold; }
    .timestamp { color: #888; font-size: 0.9em; }
    .raw-data { margin-top: 10px; white-space: pre-wrap; font-size: 0.8em; }
    .qr-image { max-width: 200px; border: 2px solid #00ff00; margin: 10px 0; }
    .stats { position: fixed; top: 10px; right: 10px; background: #333; padding: 10px; border-radius: 5px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>WRadar - Event Monitor</h1>
    <p>Real-time WhatsApp Web event capture</p>
  </div>
  <div class="stats">
    <div>Events: <span id="count">0</span></div>
    <div>Status: <span id="status">Connecting...</span></div>
  </div>
  <div id="events"></div>

  <script>
    const eventsDiv = document.getElementById('events');
    const countSpan = document.getElementById('count');
    const statusSpan = document.getElementById('status');
    let eventCount = 0;

    const eventSource = new EventSource('/events');
    
    eventSource.onopen = () => {
      statusSpan.textContent = 'Connected';
      statusSpan.style.color = '#00ff00';
    };
    
    eventSource.onerror = () => {
      statusSpan.textContent = 'Disconnected';
      statusSpan.style.color = '#ff0000';
    };
    
    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        displayEvent(event);
        eventCount++;
        countSpan.textContent = eventCount;
      } catch (err) {
        console.error('Failed to parse event:', err);
      }
    };

    function displayEvent(event) {
      const div = document.createElement('div');
      div.className = 'event';
      
      const timestamp = new Date(event.timestamp).toLocaleString();
      let content = \`<div class="event-type">\${event.event}</div>\`;
      content += \`<div class="timestamp">\${timestamp}</div>\`;
      
      // Special handling for QR events
      if (event.event === 'qr' && event.rawData && event.rawData.dataURL) {
        content += \`<img class="qr-image" src="\${event.rawData.dataURL}" alt="QR Code" />\`;
      }
      
      // Show raw data
      content += \`<div class="raw-data">\${JSON.stringify(event.rawData, null, 2)}</div>\`;
      
      div.innerHTML = content;
      eventsDiv.insertBefore(div, eventsDiv.firstChild);
      
      // Keep only last 50 events in DOM
      while (eventsDiv.children.length > 50) {
        eventsDiv.removeChild(eventsDiv.lastChild);
      }
    }
  </script>
</body>
</html>`;
    
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  serveSSE(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    // Send existing events
    this.events.forEach(event => {
      res.write(`data: ${JSON.stringify(event)}\\n\\n`);
    });

    // Add client to set
    this.clients.add(res);

    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  handleWebhook(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const event = JSON.parse(body);
        this.addEvent(event);
        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        res.writeHead(400);
        res.end('Bad Request');
      }
    });
  }

  addEvent(event) {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    // Broadcast to all SSE clients
    const data = JSON.stringify(event);
    this.clients.forEach(client => {
      try {
        client.write(`data: ${data}\\n\\n`);
      } catch (e) {
        this.clients.delete(client);
      }
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.clients.clear();
    }
  }
}

module.exports = EventServer;