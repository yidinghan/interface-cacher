const createMemoryClient = () => {
  const store = new Map();

  return {
    get: async (key) => {
      const value = store.get(key);
      return Buffer.isBuffer(value) ? value.toString() : value || null;
    },
    getBuffer: async (key) => store.get(key) || null,
    set: async (key, value) => {
      store.set(key, Buffer.isBuffer(value) ? value : Buffer.from(value));
    },
    del: async (key) => (store.delete(key) ? 1 : 0),
    ttl: async () => 10,
  };
};

module.exports = createMemoryClient;
