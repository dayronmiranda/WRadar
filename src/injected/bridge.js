// Bridge Communication - runs in page context
// - Event queue on window.WRadar with immediate notification
// - dequeueAll() used by Node polling loop
// - Notification mechanism to reduce polling latency
(function() {
  if (window.WRadar) return;
  
  const q = [];
  let notificationCallback = null;
  
  window.WRadar = {
    enqueue(evt) {
      try { 
        q.push(evt);
        
        // Immediate notification if callback is set
        if (notificationCallback && typeof notificationCallback === 'function') {
          try {
            notificationCallback(q.length);
          } catch (e) {
            // Ignore callback errors
          }
        }
      } catch (e) {}
    },
    
    dequeueAll() {
      try {
        if (!q.length) return [];
        const copy = q.slice();
        q.length = 0;
        return copy;
      } catch (e) { return []; }
    },
    
    // Set notification callback for immediate processing
    setNotificationCallback(callback) {
      notificationCallback = callback;
    },
    
    // Get queue stats
    getStats() {
      return {
        queueLength: q.length,
        hasCallback: !!notificationCallback
      };
    }
  };
})();