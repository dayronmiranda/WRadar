// WhatsApp Store Access - Based on whatsapp-web.js ExposeStore approach
(function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    // Disable console logs to avoid detection - only emit events
    // console.log('[WRadar:store]', msg);
  }

  function emit(event, raw) {
    try {
      const payload = { event, timestamp: Date.now(), rawData: raw };
      if (window.WRadar && window.WRadar.enqueue) {
        window.WRadar.enqueue(payload);
        log(`Emitted: ${event}`);
      } else {
        log('WRadar bridge not available');
      }
    } catch (e) {
      log('Emit error: ' + String(e));
    }
  }

  function serializeMsg(msg) {
    try {
      const result = {};
      
      // Core message fields
      if (msg.id) result.id = msg.id;
      if (msg.body) result.body = msg.body;
      if (msg.type) result.type = msg.type;
      if (msg.from) result.from = msg.from;
      if (msg.to) result.to = msg.to;
      if (msg.t) result.timestamp = msg.t;
      if (msg.ack !== undefined) result.ack = msg.ack;
      if (msg.isNewMsg !== undefined) result.isNewMsg = msg.isNewMsg;
      
      // Media fields
      if (msg.mediaKey) result.mediaKey = msg.mediaKey;
      if (msg.mimetype) result.mimetype = msg.mimetype;
      if (msg.filehash) result.filehash = msg.filehash;
      if (msg.size) result.size = msg.size;
      if (msg.clientUrl) result.clientUrl = msg.clientUrl;
      if (msg.directPath) result.directPath = msg.directPath;
      
      // Additional fields
      if (msg.star) result.star = msg.star;
      if (msg.broadcast) result.broadcast = msg.broadcast;
      if (msg.forwarded) result.forwarded = msg.forwarded;
      if (msg.quotedMsg) result.quotedMsg = { id: msg.quotedMsg.id, body: msg.quotedMsg.body };
      if (msg.mentionedJidList) result.mentionedJidList = msg.mentionedJidList;
      
      // Try to serialize full object as backup
      try {
        result.__raw = JSON.parse(JSON.stringify(msg));
      } catch (_) {
        result.__raw_error = 'Could not serialize full object';
      }
      
      return result;
    } catch (e) {
      log('Serialize error: ' + String(e));
      return { 
        id: msg && msg.id, 
        body: msg && msg.body,
        error: 'serialization_failed'
      };
    }
  }

  function exposeStore() {
    try {
      log('Attempting to expose Store using window.require...');
      
      // Check if window.require is available
      if (!window.require) {
        log('window.require not available');
        return false;
      }

      // Build Store object like whatsapp-web.js does
      window.Store = Object.assign({}, window.require('WAWebCollections'));
      window.Store.Conn = window.require('WAWebConnModel').Conn;
      window.Store.Cmd = window.require('WAWebCmd').Cmd;
      window.Store.User = window.require('WAWebUserPrefsMeUser');
      
      log('Store exposed successfully');
      return true;
    } catch (e) {
      log('Failed to expose Store: ' + String(e));
      return false;
    }
  }

  function findStore() {
    log('Looking for Store...');
    
    // Method 1: Direct window.Store
    if (window.Store && window.Store.Msg && window.Store.Conn) {
      log('Found complete window.Store');
      return window.Store;
    }

    // Method 2: Try to expose Store using window.require
    if (exposeStore()) {
      if (window.Store && window.Store.Msg && window.Store.Conn) {
        log('Successfully exposed and found Store');
        return window.Store;
      }
    }

    // Method 3: Try webpack chunk approach as fallback
    try {
      if (window.webpackChunkwhatsapp_web_client) {
        const chunk = window.webpackChunkwhatsapp_web_client;
        
        // Push a dummy chunk to get access to webpack require
        let webpackRequire;
        chunk.push([
          ['__WRadar__'],
          {},
          (r) => { webpackRequire = r; }
        ]);
        
        if (webpackRequire) {
          log('Got webpack require via chunk');
          // Set window.require if not available
          if (!window.require) {
            window.require = webpackRequire;
            log('Set window.require from webpack');
            
            // Try to expose Store again
            if (exposeStore()) {
              if (window.Store && window.Store.Msg && window.Store.Conn) {
                log('Successfully exposed Store via webpack require');
                return window.Store;
              }
            }
          }
        }
      }
    } catch (e) {
      log('Webpack chunk approach failed: ' + String(e));
    }

    log('No Store found');
    return null;
  }

  async function waitForStore() {
    for (let i = 0; i < 300; i++) { // up to ~30s
      const store = findStore();
      if (store) {
        log('Store found after ' + (i * 100) + 'ms');
        return store;
      }
      await sleep(100);
    }
    log('Store not found after 30s');
    return null;
  }

  async function setup() {
    log('Starting store setup...');
    const Store = await waitForStore();
    if (!Store) {
      log('No Store found, cannot setup listeners');
      // Emit a diagnostic event
      emit('store_not_found', { 
        webpackChunk: !!window.webpackChunkwhatsapp_web_client,
        windowStore: !!window.Store,
        windowRequire: !!window.require,
        timestamp: Date.now()
      });
      return;
    }

    log('Store available, setting up listeners...');

    // Connection state monitor
    try {
      if (Store.Conn) {
        log('Setting up connection listeners');
        
        // Try different connection event patterns
        if (Store.Conn.on) {
          Store.Conn.on('change:state', (state) => {
            log('Connection state changed: ' + state);
            emit('connection_state', { state, source: 'Conn.on.change:state' });
          });
        }
        
        if (Store.Conn.ev && Store.Conn.ev.on) {
          Store.Conn.ev.on('change:state', (state) => {
            log('Connection state changed via ev: ' + state);
            emit('connection_state', { state, source: 'Conn.ev.change:state' });
          });
        }
        
        // Check current state
        if (Store.Conn.state) {
          log('Current connection state: ' + Store.Conn.state);
          emit('connection_state', { state: Store.Conn.state, source: 'direct' });
        }
      }
    } catch (e) {
      log('Connection setup error: ' + String(e));
    }

    // Message events
    try {
      if (Store.Msg) {
        log('Setting up message listeners on Store.Msg');
        
        if (Store.Msg.on) {
          Store.Msg.on('add', (msg) => {
            log('Message added: ' + (msg.body || msg.type || 'unknown'));
            emit('message_create', serializeMsg(msg));
          });
          
          Store.Msg.on('change', (msg) => {
            log('Message changed: ack=' + msg.ack);
            if (msg.ack === 1) emit('message_received', serializeMsg(msg));
            if (msg.ack === 2) emit('message_delivered', serializeMsg(msg));
            if (msg.ack === 3) emit('message_read', serializeMsg(msg));
          });
          
          Store.Msg.on('change:ack', (msg) => {
            log('Message ack changed: ' + msg.ack);
            if (msg.ack === 1) emit('message_received', serializeMsg(msg));
            if (msg.ack === 2) emit('message_delivered', serializeMsg(msg));
            if (msg.ack === 3) emit('message_read', serializeMsg(msg));
          });
          
          log('Message listeners attached to Store.Msg');
        } else {
          log('Store.Msg exists but no .on method');
        }
      } else {
        log('No Store.Msg found');
      }
    } catch (e) {
      log('Message setup error: ' + String(e));
    }

    log('Store setup complete');
    emit('store_ready', { 
      hasMsg: !!Store.Msg, 
      hasConn: !!Store.Conn,
      msgMethods: Store.Msg ? Object.getOwnPropertyNames(Store.Msg) : [],
      connMethods: Store.Conn ? Object.getOwnPropertyNames(Store.Conn) : [],
      connState: Store.Conn && Store.Conn.state
    });
  }

  // Start setup with delay to ensure webpack is fully loaded
  log('Store script loaded, waiting for webpack to be ready...');
  
  setTimeout(() => {
    setup().catch(e => log('Setup failed: ' + String(e)));
  }, 2000);
})();
