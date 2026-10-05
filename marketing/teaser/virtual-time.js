// Injected into every frame (including the orb iframes) before page scripts run.
// requestAnimationFrame, performance.now and Date.now follow a clock that only moves
// when the renderer calls __vt.advanceTo(ms), so every frame of the video is reproducible.
(() => {
  if (window.__vt) return;
  const epoch = Date.UTC(2026, 9, 5, 9, 41);
  let now = 0;
  let queue = new Map();
  let nextId = 1;

  performance.now = () => now;
  Date.now = () => epoch + now;
  window.requestAnimationFrame = (cb) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };

  window.__vt = {
    advanceTo(ms) {
      now = Math.max(now, ms);
      const due = queue;
      queue = new Map();
      for (const cb of due.values()) {
        try {
          cb(now);
        } catch (error) {
          console.error(error);
        }
      }
    },
    get now() {
      return now;
    },
  };
})();
