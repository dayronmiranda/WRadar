/*
 WRadar - Browser Controller / Entry point
 - Launch rebrowser-puppeteer-core
 - Navigate to web.whatsapp.com
 - Inject monitoring scripts (bridge/store)
 - Handle QR and ready events
 - Poll event queue and dispatch via webhook
*/

const fs = require('fs');
const path = require('path');
const puppeteer = require('rebrowser-puppeteer-core');

const config = require('../config/default.json');
const Client = require('./client');
const Session = require('./session');
const EventServer = require('./server');
const NatsClient = require('./nats/client');
const NatsPublisher = require('./nats/publisher');
const WebhookConsumer = require('./nats/consumers/webhook');
const { MediaConsumer } = require('./nats/consumers/media');
const { MediaQueue } = require('./media/queue');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const INJECTED_DIR = path.join(__dirname, 'injected');

async function ensureDirs() {
  const sessionDir = path.resolve(PROJECT_ROOT, config.session.path);
  const profileDir = path.join(sessionDir, 'chrome-profile');
  const mediaDir = path.resolve(PROJECT_ROOT, config.media.path);
  for (const dir of [sessionDir, profileDir, mediaDir]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveExecutablePath() {
  // Priority: env -> config -> common Windows paths
  const fromEnv = process.env.BROWSER_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const fromCfg = config.browser && config.browser.executablePath;
  if (fromCfg && fs.existsSync(fromCfg)) return fromCfg;

  // Try common Windows locations for Chrome/Edge
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getLaunchOptions() {
  const headless = config.browser.headless ? 'new' : false;
  const executablePath = resolveExecutablePath();
  const channel = executablePath ? undefined : (process.env.BROWSER_CHANNEL || (config.browser && config.browser.channel) || 'chrome');
  const userDataDir = path.resolve(PROJECT_ROOT, config.session.path, 'chrome-profile');
  const opts = {
    headless,
    userDataDir,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-features=site-per-process'
    ],
    defaultViewport: config.browser.viewport || { width: 1200, height: 800 }
  };
  if (executablePath) opts.executablePath = executablePath;
  else opts.channel = channel;
  return opts;
}

async function prepareInjection(page) {
  const bridgePath = path.join(INJECTED_DIR, 'bridge.js');
  const storePath = path.join(INJECTED_DIR, 'store.js');
  const bridgeCode = fs.readFileSync(bridgePath, 'utf8');
  const storeCode = fs.readFileSync(storePath, 'utf8');
  await page.evaluateOnNewDocument(bridgeCode);
  await page.evaluateOnNewDocument(storeCode);
}

async function watchQr(page, client) {
  let lastQr = null;
  async function readQrFromCanvas() {
    try {
      // Try more specific selectors first
      const qrDataUrl = await page.evaluate(() => {
        const candidates = [
          'canvas[aria-label*="Scan"]',
          'canvas[aria-label*="scan"]',
          'canvas',
        ];
        for (const sel of candidates) {
          const c = document.querySelector(sel);
          if (c && c.toDataURL) {
            const d = c.toDataURL('image/png');
            // Basic sanity check: QR canvases are usually large data URLs
            if (d && d.length > 10000) return d;
          }
        }
        return null;
      });
      if (qrDataUrl && qrDataUrl !== lastQr) {
        lastQr = qrDataUrl;
        client.emitEvent({ event: 'qr', timestamp: Date.now(), rawData: { dataURL: qrDataUrl } });
      }
    } catch (e) {
      // Ignore transient DOM errors
    }
  }

  // Poll every 1s for QR updates while not ready
  const interval = setInterval(readQrFromCanvas, 1000);
  return () => clearInterval(interval);
}

async function detectReady(page, client) {
  const selectors = [
    '[data-testid="chat-list"]',
    '[data-testid="conversation-panel-messages"]',
    '[data-testid="chat"]',
    'div[role="grid"]'
  ];
  // Poll until any selector appears or Store indicates ready
  while (true) {
    try {
      // Try a short wait for any selector
      const found = await Promise.race(
        selectors.map(sel => page.waitForSelector(sel, { timeout: 3000 }).then(() => sel))
      );
      if (found) {
        client.emitEvent({ event: 'ready', timestamp: Date.now(), rawData: { state: 'ready', via: 'selector', selector: found } });
        return;
      }
    } catch (_) {
      // none found within 3s, continue
    }
    try {
      const hasStoreConn = await page.evaluate(() => !!(window.Store && window.Store.Conn));
      if (hasStoreConn) {
        client.emitEvent({ event: 'ready', timestamp: Date.now(), rawData: { state: 'ready', via: 'store' } });
        return;
      }
    } catch (_) {}
  }
}

async function startEventPolling(page, client) {
  async function drainOnce() {
    try {
      const events = await page.evaluate(() => {
        const w = window;
        if (!w || !w.WRadar || typeof w.WRadar.dequeueAll !== 'function') return [];
        return w.WRadar.dequeueAll();
      });
      if (Array.isArray(events) && events.length) {
        for (const evt of events) {
          await client.emitEvent(evt);
        }
      }
    } catch (e) {
      // ignore polling errors
    }
  }
  const interval = setInterval(drainOnce, 300);
  return () => clearInterval(interval);
}

async function main() {
  await ensureDirs();

  // Initialize NATS (optional)
  let natsClient = null;
  let natsPublisher = null;
  let webhookConsumer = null;
  let mediaConsumer = null;
  let mediaQueue = null;

  // Start event server
  const eventServer = new EventServer(config.webhook.port || 3001);
  eventServer.start();

  console.log('[WRadar] Launching browser...');
  const browser = await puppeteer.launch(getLaunchOptions());
  const page = await browser.newPage();
  page.on('console', (msg) => {
    try { console.log('[WRadar:page]', msg.type().toUpperCase(), msg.text()); } catch (_) {}
  });
  page.on('domcontentloaded', () => console.log('[WRadar:page] DOMContentLoaded'));
  page.on('load', () => console.log('[WRadar:page] load'));
  page.on('framenavigated', (f) => { if (f.url()) console.log('[WRadar:page] navigated', f.url()); });
  console.log('[WRadar] Browser launched');

  // Browser config
  if (config.browser.userAgent) {
    await page.setUserAgent(config.browser.userAgent);
  }
  if (config.browser.viewport) {
    await page.setViewport(config.browser.viewport);
  }

  console.log('[WRadar] Preparing init scripts');
  await prepareInjection(page);
  console.log('[WRadar] Init scripts registered');

  const session = new Session({
    sessionPath: path.resolve(PROJECT_ROOT, config.session.path),
    fileName: config.session.filename,
  });

  await session.restore(page);

  // Initialize media queue (requires browser page)
  if (config.media.enabled) {
    mediaQueue = new MediaQueue(
      page, 
      path.resolve(PROJECT_ROOT, config.media.path),
      config.media
    );
    console.log('[WRadar] Media download queue initialized');
  }

  if (config.nats && config.nats.enabled) {
    try {
      natsClient = new NatsClient(config.nats);
      const connected = await natsClient.connect();
      
      if (connected) {
        natsPublisher = new NatsPublisher(natsClient);
        
        // Start consumers
        webhookConsumer = new WebhookConsumer(natsClient, config.webhook);
        await webhookConsumer.start();
        
        mediaConsumer = new MediaConsumer(
          natsClient, 
          config.media, 
          path.resolve(PROJECT_ROOT, config.media.path),
          mediaQueue
        );
        await mediaConsumer.start();
        
        console.log('[WRadar] NATS JetStream initialized with consumers');
      }
    } catch (error) {
      console.log(`[WRadar] NATS initialization failed: ${error.message}`);
      console.log('[WRadar] Continuing without NATS (direct webhook mode)');
    }
  } else {
    console.log('[WRadar] NATS disabled in config');
  }

  const client = new Client({
    webhook: config.webhook,
    media: config.media,
    storageDir: path.resolve(PROJECT_ROOT, config.media.path),
    eventServer: eventServer,
    natsPublisher: natsPublisher
  });

  // Show configuration
  if (natsPublisher) {
    console.log('[WRadar] Event routing: WhatsApp → NATS JetStream → Consumers');
    const stats = await natsPublisher.getStats();
    if (stats.stream) {
      console.log(`[WRadar] NATS Stream: ${stats.stream.name} (${stats.stream.messages} messages)`);
    }
  } else {
    console.log('[WRadar] Event routing: WhatsApp → Direct webhook');
    if (config.webhook.enabled) {
      const webhookInfo = client.webhook.getInfo();
      console.log(`[WRadar] External webhook: ${webhookInfo.url}`);
    } else {
      console.log('[WRadar] External webhook: disabled');
    }
  }

  if (mediaQueue) {
    console.log('[WRadar] Media downloads: Browser-based with queue');
  } else {
    console.log('[WRadar] Media downloads: Disabled');
  }

  client.on('event', (evt) => {
    try {
      const name = evt && evt.event;
      let extra = '';
      if (name === 'qr') {
        const len = (evt.rawData && evt.rawData.dataURL && evt.rawData.dataURL.length) || 0;
        extra = ` dataURL=${len}b`;
      } else if (name === 'message_create' || name === 'message_received') {
        const body = evt.rawData && evt.rawData.body;
        if (body) extra = ` body=${String(body).slice(0, 60)}`;
      } else if (name === 'connection_state') {
        const state = evt.rawData && evt.rawData.state;
        extra = ` state=${state}`;
      }
      console.log(`[WRadar:event] ${name}${extra}`);
    } catch (_) {}
  });

  page.on('close', () => {
    client.emitEvent({ event: 'connection_state', timestamp: Date.now(), rawData: { state: 'page_closed' } });
  });

  page.on('error', (err) => {
    client.emitEvent({ event: 'connection_state', timestamp: Date.now(), rawData: { state: 'page_error', message: String(err) } });
  });

  const targetUrl = 'https://web.whatsapp.com/';
  if (!page.url().startsWith(targetUrl)) {
    console.log('[WRadar] Navigating to WhatsApp Web');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  } else {
    console.log('[WRadar] Already at WhatsApp Web');
  }

  // Verify bridge presence
  try {
    await page.waitForFunction(() => window.WRadar && !!window.WRadar.dequeueAll, { timeout: 5000 });
    console.log('[WRadar] Bridge present: true');
  } catch (e) {
    console.log('[WRadar] Bridge present: false (will still attempt event polling)');
  }

  // Start QR watcher and ready detector
  const stopQr = await watchQr(page, client);
  detectReady(page, client); // fire and forget

  // Start polling for in-page events
  const stopPolling = await startEventPolling(page, client);
  console.log('[WRadar] Started polling + QR watcher');

  // Persist session periodically and on exit
  const persist = async () => {
    try { await session.save(page); } catch (_) {}
  };
  const persistInterval = setInterval(persist, 5000);

  const cleanup = async () => {
    console.log('[WRadar] Shutting down...');
    stopQr();
    stopPolling();
    clearInterval(persistInterval);
    await persist();
    
    // Stop NATS consumers
    if (webhookConsumer) {
      await webhookConsumer.stop();
    }
    if (mediaConsumer) {
      await mediaConsumer.stop();
    }
    if (natsClient) {
      await natsClient.close();
    }
    
    eventServer.stop();
    try { await page.close(); } catch (_) {}
    try { await browser.close(); } catch (_) {}
    console.log('[WRadar] Shutdown complete');
  };

  process.on('SIGINT', async () => { await cleanup(); process.exit(0); });
  process.on('SIGTERM', async () => { await cleanup(); process.exit(0); });
}

main().catch(err => {
  console.error('[WRadar] Fatal error:', err);
  process.exit(1);
});