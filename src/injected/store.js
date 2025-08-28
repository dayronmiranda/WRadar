// WhatsApp Store Access - Complete moduleRaid implementation
(function() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function log(msg) {
    // Disable console logs to avoid detection - only emit events
    // console.log('[WRadar:store]', msg);
  }

  function emit(event, raw) {
    try {
      const payload = { event, timestamp: Date.now(), rawData: raw };
      const bridge = window[Symbol.for('__wb_bridge')];
      if (bridge && bridge.enqueue) {
        bridge.enqueue(payload);
        log(`Emitted: ${event}`);
      } else {
        log('Bridge not available');
      }
    } catch (e) {
      log('Emit error: ' + String(e));
    }
  }

  function serializeMsg(msg) {
    try {
      const result = {};
      
      // Core message fields
      if (msg.id) {
        // Serialize complete ID object, not just _serialized
        result.id = {
          _serialized: msg.id._serialized,
          fromMe: msg.id.fromMe,
          remote: msg.id.remote,
          id: msg.id.id
        };
      }
      if (msg.body) result.body = msg.body;
      if (msg.type) result.type = msg.type;
      if (msg.from) result.from = msg.from;
      if (msg.to) result.to = msg.to;
      if (msg.t) result.timestamp = msg.t;
      if (msg.ack !== undefined) result.ack = msg.ack;
      if (msg.isNewMsg !== undefined) result.isNewMsg = msg.isNewMsg;
      
      // Media fields - complete serialization
      if (msg.mediaKey) result.mediaKey = msg.mediaKey;
      if (msg.mediaKeyTimestamp) result.mediaKeyTimestamp = msg.mediaKeyTimestamp;
      if (msg.mimetype) result.mimetype = msg.mimetype;
      if (msg.filehash) result.filehash = msg.filehash;
      if (msg.encFilehash) result.encFilehash = msg.encFilehash;
      if (msg.size) result.size = msg.size;
      if (msg.clientUrl) result.clientUrl = msg.clientUrl;
      if (msg.directPath) result.directPath = msg.directPath;
      if (msg.mediaData) result.mediaData = msg.mediaData;
      if (msg.thumbnail) result.thumbnail = msg.thumbnail;
      
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

  function moduleRaid() {
    // Complete module raid implementation
    const modules = {};
    
    if (window.webpackChunkwhatsapp_web_client) {
      const chunk = window.webpackChunkwhatsapp_web_client;
      
      // Get webpack require function
      let webpackRequire;
      chunk.push([
        ['__moduleRaid__'],
        {},
        (r) => { webpackRequire = r; }
      ]);
      
      if (webpackRequire && webpackRequire.cache) {
        log('Starting module raid...');
        
        // Extract all modules
        for (const moduleId in webpackRequire.cache) {
          try {
            const module = webpackRequire.cache[moduleId];
            if (module && module.exports) {
              modules[moduleId] = module.exports;
            }
          } catch (_) {}
        }
        
        log(`Found ${Object.keys(modules).length} modules`);
        return modules;
      }
    }
    
    return modules;
  }

  function findModule(condition) {
    const modules = moduleRaid();
    
    for (const moduleId in modules) {
      try {
        const module = modules[moduleId];
        if (condition(module)) {
          log(`Found module: ${moduleId}`);
          return module;
        }
      } catch (_) {}
    }
    
    return null;
  }

  function findModules(condition) {
    const modules = moduleRaid();
    const found = [];
    
    for (const moduleId in modules) {
      try {
        const module = modules[moduleId];
        if (condition(module)) {
          found.push(module);
        }
      } catch (_) {}
    }
    
    return found;
  }

  function exposeStore() {
    try {
      log('Starting Store exposure with module raid...');
      
      // Initialize Store object
      window.Store = {};
      
      // Find Collections (Msg, Chat, Contact, etc.)
      const collections = findModule(m => 
        m && m.Msg && m.Chat && m.Contact && 
        typeof m.Msg.add === 'function' &&
        typeof m.Chat.add === 'function'
      );
      
      if (collections) {
        Object.assign(window.Store, collections);
        log('Found Collections module');
      }
      
      // Find Connection module
      const connModule = findModule(m => 
        m && m.Conn && m.Conn.on && 
        typeof m.Conn.on === 'function'
      );
      
      if (connModule) {
        window.Store.Conn = connModule.Conn;
        log('Found Connection module');
      }
      
      // Find DownloadManager - multiple patterns
      let downloadManager = findModule(m => 
        m && m.downloadManager && 
        typeof m.downloadManager.downloadMedia === 'function'
      );
      
      if (!downloadManager) {
        downloadManager = findModule(m => 
          m && m.downloadMedia && 
          typeof m.downloadMedia === 'function'
        );
      }
      
      if (downloadManager) {
        window.Store.DownloadManager = downloadManager.downloadManager || downloadManager;
        log('Found DownloadManager module');
      }
      
      // Find Media utilities
      const mediaUtils = findModule(m => 
        m && (m.decryptMedia || m.downloadMedia) && 
        (typeof m.decryptMedia === 'function' || typeof m.downloadMedia === 'function')
      );
      
      if (mediaUtils) {
        window.Store.MediaUtils = mediaUtils;
        log('Found MediaUtils module');
      }
      
      // Find OpaqueData for media handling
      const opaqueData = findModule(m => 
        m && m.createFromData && 
        typeof m.createFromData === 'function'
      );
      
      if (opaqueData) {
        window.Store.OpaqueData = opaqueData;
        log('Found OpaqueData module');
      }
      
      // Find MediaPrep
      const mediaPrep = findModule(m => 
        m && m.prepRawMedia && 
        typeof m.prepRawMedia === 'function'
      );
      
      if (mediaPrep) {
        window.Store.MediaPrep = mediaPrep;
        log('Found MediaPrep module');
      }
      
      // Add helper function for media download
      window.Store.downloadMedia = async function(messageId) {
        try {
          // Find message by ID
          let message = null;
          
          if (typeof messageId === 'string') {
            // Find by serialized ID
            message = window.Store.Msg.get(messageId);
          } else if (messageId && messageId._serialized) {
            // Find by ID object
            message = window.Store.Msg.get(messageId._serialized);
          } else {
            // Assume it's already a message object
            message = messageId;
          }
          
          if (!message) {
            throw new Error('Message not found');
          }
          
          // Method 1: Try message's own downloadMedia method
          if (message.downloadMedia && typeof message.downloadMedia === 'function') {
            log('Using message.downloadMedia()');
            return await message.downloadMedia();
          }
          
          // Method 2: Try DownloadManager
          if (window.Store.DownloadManager && window.Store.DownloadManager.downloadMedia) {
            log('Using DownloadManager.downloadMedia()');
            return await window.Store.DownloadManager.downloadMedia(message);
          }
          
          // Method 3: Try MediaUtils
          if (window.Store.MediaUtils && window.Store.MediaUtils.downloadMedia) {
            log('Using MediaUtils.downloadMedia()');
            return await window.Store.MediaUtils.downloadMedia(message);
          }
          
          // Method 4: Try direct decryption if we have the utilities
          if (window.Store.MediaUtils && window.Store.MediaUtils.decryptMedia && message.mediaKey) {
            log('Using MediaUtils.decryptMedia()');
            // This would need the encrypted media first
            throw new Error('Direct decryption not implemented yet');
          }
          
          throw new Error('No download method available');
        } catch (error) {
          log('Download error: ' + error.message);
          throw error;
        }
      };
      
      log('Store exposed successfully with media support');
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

    // Method 2: Try to expose Store using moduleRaid
    if (exposeStore()) {
      if (window.Store && window.Store.Msg && window.Store.Conn) {
        log('Successfully exposed and found Store');
        return window.Store;
      }
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
      hasDownloadManager: !!Store.DownloadManager,
      hasMediaUtils: !!Store.MediaUtils,
      hasDownloadMedia: !!Store.downloadMedia,
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