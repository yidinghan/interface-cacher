const test = require('ava').default;
const v8 = require('v8');

const Cacher = require('../../lib/cache');
const createRedisClient = require('./_redis-client');

const serializer = {
  binary: true,
  serialize: v8.serialize,
  deserialize: v8.deserialize,
};

test('serializer: v8', async (t) => {
  const redisClient = createRedisClient();
  t.teardown(() => redisClient.quit());
  await redisClient.del('EXAMPLE_SERIALIZER_v8');

  const cacher = new Cacher({
    redisClient,
    prefix: 'EXAMPLE_SERIALIZER_',
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
  t.true(Buffer.isBuffer(await redisClient.getBuffer('EXAMPLE_SERIALIZER_v8')));
});
