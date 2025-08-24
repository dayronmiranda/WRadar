// Bridge Communication - runs in page context
// - Event queue on window.WRadar
// - dequeueAll() used by Node polling loop
(function() {
  if (window.WRadar) return;
  const q = [];
  window.WRadar = {
    enqueue(evt) {
      try { q.push(evt); } catch (e) {}
    },
    dequeueAll() {
      try {
        if (!q.length) return [];
        const copy = q.slice();
        q.length = 0;
        return copy;
      } catch (e) { return []; }
    }
  };
})();
