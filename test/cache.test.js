const _ = require('lodash');
const test = require('ava').default;
const Redis = require('ioredis');

const Cacher = require('../lib/cache');

const opt = {
  redis: {
    host: '127.0.0.1',
    port: '6379',
    db: '12',
  },
  prefix: 'TEST_',
  expire: 5,
};

const client = new Redis(opt.redis);
const cacher = new Cacher(opt);

const KEY = `${opt.prefix}getShopes`;
const getShopes = async (type) => {
  if (type === 0) {
    throw new Error('bad params');
  }

  if (type === 2) {
    return undefined;
  }

  if (type === 3) {
    return 'ding';
  }

  return ['shop01', 'shop02'];
};

test.beforeEach(async () => client.flushdb());

const wait = async (time = 10) => {
  await new Promise((resolve) => setTimeout(resolve, time));
};

test('cache: should support raw:false', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 3),
    raw: false,
  };
  const data = await cacher.get(payload);
  t.is(data, 'ding');
  await wait();
  const data2 = await client.get(KEY);
  t.is(data2, '"ding"');
});

test('cache: should support raw param with data<string>', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 3),
    raw: true,
  };
  const data = await cacher.get(payload);
  t.is(data, 'ding');
  await wait();
  const data2 = await client.get(KEY);
  t.is(data2, 'ding');
});

test('cache: should cache results in redis', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 1),
  };
  return cacher
    .get(payload)
    .then((data) => {
      t.deepEqual(data, ['shop01', 'shop02']);
      return client.get(KEY);
    })
    .then((data) => t.is(data, '["shop01","shop02"]'));
});

test('cache: should not cache when executor reject', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 0),
  };
  return cacher
    .get(payload)
    .catch((err) => {
      t.is(err.message, 'bad params');
      return client.get(KEY);
    })
    .then((data) => t.is(data, null));
});

test('cache: should return cache data when hit', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 1),
    expire: 100,
  };
  return client
    .set(KEY, '["shop01"]')
    .then(() => cacher.get(payload))
    .then((data) => {
      t.true(_.isArray(data));
      t.deepEqual(data, ['shop01']);
    });
});

test('cache: should recache when cache is outdated', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 1),
  };
  await client.set(KEY, '["shop01"]', 'px', 10);
  await wait(11);
  const data = await cacher.get(payload);
  t.true(_.isArray(data));
  t.deepEqual(data, ['shop01', 'shop02']);
  await wait();
  const data2 = await client.get(KEY);
  t.is(data2, '["shop01","shop02"]');
});

test('cache: should use default expire when expire is less than 0', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 1),
    expire: -1,
  };
  return cacher
    .get(payload)
    .then((data) => {
      t.true(_.isArray(data));
      t.deepEqual(data, ['shop01', 'shop02']);
      return client.ttl(KEY);
    })
    .then((ttl) => t.true(ttl > 0 && ttl <= 5));
});

test('cache: should not cache when return an undefined by executor', async (t) => {
  const payload = {
    key: 'getShopes',
    executor: getShopes.bind(null, 2),
  };
  return cacher
    .get(payload)
    .then((data) => {
      t.is(data, undefined);
      return client.get(KEY);
    })
    .then((data) => t.is(data, null));
});

test('cache: should remove the key in cache', async (t) => {
  const key = 'getShopes';
  return client
    .set(KEY, '["shop01"]')
    .then(() => cacher.delete(key))
    .then((data) => {
      t.is(data, 1);
      return client.get(KEY);
    })
    .then((data) => t.is(data, null));
});
