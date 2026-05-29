const test = require('ava').default;

const Cacher = require('../../lib/cache');
const createRedisClient = require('./_redis-client');
const requireOptional = require('./_optional-require');

const { decode, encode } = requireOptional('@msgpack/msgpack');

const serializer = {
  binary: true,
  serialize: encode,
  deserialize: decode,
};

test('serializer: MessagePack', async (t) => {
  const redisClient = createRedisClient();
  t.teardown(() => redisClient.quit());
  await redisClient.del('EXAMPLE_SERIALIZER_messagepack');

  const cacher = new Cacher({
    redisClient,
    prefix: 'EXAMPLE_SERIALIZER_',
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
  t.true(Buffer.isBuffer(await redisClient.getBuffer('EXAMPLE_SERIALIZER_messagepack')));
});
