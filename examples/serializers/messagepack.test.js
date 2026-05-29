const test = require('ava').default;

const Cacher = require('../../lib/cache');
const createMemoryClient = require('./_memory-client');
const requireOptional = require('./_optional-require');

const { decode, encode } = requireOptional('@msgpack/msgpack');

const serializer = {
  binary: true,
  serialize: encode,
  deserialize: decode,
};

test('serializer: MessagePack', async (t) => {
  const cacher = new Cacher({
    redisClient: createMemoryClient(),
    serializer,
  });
  const payload = {
    key: 'messagepack',
    executor: async () => ({
      name: 'ding',
      tags: ['redis', 'cache'],
    }),
  };

  t.deepEqual(await cacher.get(payload), {
    name: 'ding',
    tags: ['redis', 'cache'],
  });
  t.deepEqual(await cacher.get({
    ...payload,
    executor: async () => {
      throw new Error('should not execute');
    },
  }), {
    name: 'ding',
    tags: ['redis', 'cache'],
  });
});
