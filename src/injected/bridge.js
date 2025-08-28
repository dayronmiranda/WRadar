// Bridge Communication - runs in page context
// - Event queue using Symbol-based bridge for stealth
// - dequeueAll() used by Node polling loop
// - Notification mechanism to reduce polling latency
(function() {
  // Prevenir doble inicialización
  const BRIDGE_KEY = Symbol.for('__wb_bridge');
  if (window[BRIDGE_KEY]) return;
  
  const eventQueue = [];
  let notificationCallback = null;
  
  // Bridge invisible usando Symbol
  window[BRIDGE_KEY] = {
    enqueue(evt) {
      try {
        eventQueue.push(evt);
        if (notificationCallback && typeof notificationCallback === 'function') {
          try {
            notificationCallback(eventQueue.length);
          } catch (e) {
            // Ignore callback errors
          }
        }
      } catch (e) {}
    },
    
    dequeueAll() {
      try {
        if (!eventQueue.length) return [];
        const copy = eventQueue.slice();
        eventQueue.length = 0;
        return copy;
      } catch (e) { return []; }
    },
    
    setNotificationCallback(callback) {
      notificationCallback = callback;
    },
    
    getStats() {
      return {
        queueLength: eventQueue.length,
        hasCallback: !!notificationCallback
      };
    }
  };
})();