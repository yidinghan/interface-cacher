const test = require('ava').default;
const v8 = require('v8');

const Cacher = require('../../lib/cache');
const createMemoryClient = require('./_memory-client');

const serializer = {
  binary: true,
  serialize: v8.serialize,
  deserialize: v8.deserialize,
};

test('serializer: v8', async (t) => {
  const cacher = new Cacher({
    redisClient: createMemoryClient(),
    serializer,
  });
  const payload = {
    key: 'v8',
    executor: async () => ({
      name: 'ding',
      nested: {
        count: 2,
      },
    }),
  };

  t.deepEqual(await cacher.get(payload), {
    name: 'ding',
    nested: {
      count: 2,
    },
  });
  t.deepEqual(await cacher.get({
    ...payload,
    executor: async () => {
      throw new Error('should not execute');
    },
  }), {
    name: 'ding',
    nested: {
      count: 2,
    },
  });
});
