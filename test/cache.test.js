/* eslint-disable no-plusplus */
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

const KEY_INPUT = `getShopes`;
const KEY = opt.prefix + KEY_INPUT;
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

test.beforeEach(async () => {
  await client.flushdb();
  cacher.mem.clear();
});

const wait = async (time = 10) => {
  // eslint-disable-next-line no-promise-executor-return
  await new Promise((resolve) => setTimeout(resolve, time));
};

test('cache: should read mem cache', async (t) => {
  await client.set(KEY, '"ding"', 'px', cacher.minRedisTtl * 2);

  t.is(cacher.mem.get(KEY), undefined);
  await cacher.get({
    key: KEY_INPUT,
    executor: getShopes.bind(null, 3),
    expire: 10,
    mem: true,
  });
  await wait();
  t.is(cacher.mem.get(KEY), 'ding');

  await client.set(KEY, '"dingding"', 'px', cacher.minRedisTtl * 2);
  await cacher.get({
    key: KEY_INPUT,
    executor: getShopes.bind(null, 3),
    expire: 10,
    mem: true,
  });
  await wait();
  t.is(cacher.mem.get(KEY), 'ding');
});

test('cache: should not cache redis data to mem when redis ttl to short', async (t) => {
  await client.set(KEY, '"ding"', 'px', cacher.minRedisTtl - 1);

  t.is(cacher.mem.get(KEY), undefined);
  await cacher.get({
    key: KEY_INPUT,
    executor: getShopes.bind(null, 3),
    expire: 10,
    mem: true,
  });
  await wait();
  t.is(cacher.mem.get(KEY), undefined);
});

test('cache: should not cache redis data to mem in first try', async (t) => {
  t.is(cacher.mem.get(KEY), undefined);
  await cacher.get({
    key: KEY_INPUT,
    executor: _.noop,
    expire: 10,
    mem: true,
  });
  await wait();
  t.is(cacher.mem.get(KEY), undefined);
});

test('cache: should cache redis data to mem in second try', async (t) => {
  let count = 0;
  t.is(cacher.mem.get(KEY), undefined);
  await cacher.get({
    key: KEY_INPUT,
    executor: () => {
      count++;
      return 'ding';
    },
    expire: 10,
    mem: true,
  });
  await wait();
  t.is(cacher.mem.get(KEY), undefined);
  t.is(count, 1);

  await cacher.get({
    key: KEY_INPUT,
    executor: () => {
      count++;
      return 'ding';
    },
    expire: 10,
    mem: true,
  });
  await wait();
  t.is(count, 1);
  t.is(cacher.mem.get(KEY), 'ding');
  // 第二次 get 的时候已经是 10ms 之后了
  // 而放到内存是也应该小于 epxire 的 10s
  t.true(cacher.mem.getRemainingTTL(KEY) < 10000);
});

test('cache: should cache redis data to mem', async (t) => {
  await client.set(KEY, '"ding"', 'ex', 10);

  t.is(cacher.mem.get(KEY), undefined);
  await cacher.get({
    key: KEY_INPUT,
    executor: _.noop,
    expire: 10,
    mem: true,
  });
  await wait();
  t.is(cacher.mem.get(KEY), 'ding');
});

test('cache: should support mem false', async (t) => {
  const instance = new Cacher({ mem: false });
  t.is(instance.mem, undefined);
});

test('cache: should support mem in default', async (t) => {
  const instance = new Cacher();
  t.not(instance.mem, undefined);
});

test('cache: should support raw:false', async (t) => {
  const payload = {
    key: KEY_INPUT,
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
    key: KEY_INPUT,
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
    key: KEY_INPUT,
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
    key: KEY_INPUT,
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
    key: KEY_INPUT,
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
    key: KEY_INPUT,
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
    key: KEY_INPUT,
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
    key: KEY_INPUT,
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
  const key = KEY_INPUT;
  return client
    .set(KEY, '["shop01"]')
    .then(() => cacher.delete(key))
    .then((data) => {
      t.is(data, 1);
      return client.get(KEY);
    })
    .then((data) => t.is(data, null));
});
