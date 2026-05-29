const test = require('ava').default;

const Cacher = require('../../lib/cache');
const createRedisClient = require('./_redis-client');
const requireOptional = require('./_optional-require');

const protobuf = requireOptional('protobufjs');

const CacheValue = new protobuf.Type('CacheValue')
  .add(new protobuf.Field('name', 1, 'string'))
  .add(new protobuf.Field('count', 2, 'uint32'));

const serializer = {
  binary: true,
  serialize: (value) => CacheValue.encode(CacheValue.create(value)).finish(),
  deserialize: (value) => CacheValue.toObject(CacheValue.decode(value), {
    defaults: true,
  }),
};

test('serializer: protobufjs', async (t) => {
  const redisClient = createRedisClient();
  t.teardown(() => redisClient.quit());
  await redisClient.del('EXAMPLE_SERIALIZER_protobuf');

  const cacher = new Cacher({
    redisClient,
    prefix: 'EXAMPLE_SERIALIZER_',
    serializer,
  });
  const payload = {
    key: 'protobuf',
    executor: async () => ({
      name: 'ding',
      count: 2,
    }),
  };

  t.deepEqual(await cacher.get(payload), {
    name: 'ding',
    count: 2,
  });
  t.deepEqual(await cacher.get({
    ...payload,
    executor: async () => {
      throw new Error('should not execute');
    },
  }), {
    name: 'ding',
    count: 2,
  });
  t.true(Buffer.isBuffer(await redisClient.getBuffer('EXAMPLE_SERIALIZER_protobuf')));
});
