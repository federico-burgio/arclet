// Bound individual API calls, rather than abandoning a whole controller task
// that could later resume and overwrite newer state.
export function boundedApi(api, timeoutMs = 10000) {
  function methods(target, name) {
    return new Proxy({}, {
      get(_object, key) {
        const object = target();
        const value = object?.[key];
        if (typeof value !== 'function') return value;
        return (...args) => new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(
            `${name}.${String(key)} took too long. Chrome may be waiting for a dialog; check the page and try again.`
          )), timeoutMs);
          Promise.resolve().then(() => value.apply(object, args)).then(resolve, reject)
            .finally(() => clearTimeout(timer));
        });
      }
    });
  }
  return {
    tabs: methods(() => api.tabs, 'tabs'),
    sessions: methods(() => api.sessions, 'sessions'),
    storage: {
      local: methods(() => api.storage.local, 'storage.local'),
      session: methods(() => api.storage.session, 'storage.session')
    }
  };
}
