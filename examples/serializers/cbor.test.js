const test = require('ava').default;

const Cacher = require('../../lib/cache');
const createMemoryClient = require('./_memory-client');
const requireOptional = require('./_optional-require');

const { Decoder, Encoder } = requireOptional('cbor-x');

const encoder = new Encoder();
const decoder = new Decoder();
const serializer = {
  binary: true,
  serialize: (value) => encoder.encode(value),
  deserialize: (value) => decoder.decode(value),
};

test('serializer: CBOR', async (t) => {
  const cacher = new Cacher({
    redisClient: createMemoryClient(),
    serializer,
  });
  const payload = {
    key: 'cbor',
    executor: async () => ({
      name: 'ding',
      enabled: true,
    }),
  };

  t.deepEqual(await cacher.get(payload), {
    name: 'ding',
    enabled: true,
  });
  t.deepEqual(await cacher.get({
    ...payload,
    executor: async () => {
      throw new Error('should not execute');
    },
  }), {
    name: 'ding',
    enabled: true,
  });
});
