const defaultsDeep = require('lodash.defaultsdeep');
const isUndefined = require('lodash.isundefined');
const Redis = require('ioredis');
const LRU = require('lru-cache');

const encodeCacheValue = (value, serializer, raw) => {
  if (raw) {
    return value;
  }

  if (!serializer) {
    return JSON.stringify(value);
  }

  const serialized = serializer.serialize(value);
  if (Buffer.isBuffer(serialized)) {
    return serialized;
  }

  return serialized instanceof Uint8Array
    ? Buffer.from(serialized)
    : serialized;
};

const decodeCacheValue = (value, serializer, raw) => {
  if (raw) {
    return value;
  }

  return serializer
    ? serializer.deserialize(value)
    : JSON.parse(value);
};

class Cacher {
  /**
   * @param {Object} payload
   * @param {Object} [payload.redis] 用于redis的连接
   * @param {string} [payload.redis.host=localhost] host ip of redis
   * @param {number} [payload.redis.port=6379] port of redis
   * @param {number} [payload.redis.db=12] cache db of redis
   * @param {IORedis.AbstractConnector} [payload.redisClient] client like cluster or sentinel redis
   * @param {string} [payload.prefix=cache.] key的默认前缀
   * @param {number} [payload.expire=5] key的有效期，单位s
   * @param {object|boolean} [payload.mem] 内存缓存配置，传false表示不启用。全部参数可以看这个[文档说明](https://github.com/isaacs/node-lru-cache#usage)
   * @param {number} [payload.mem.minRedisTtl] 最小可放内存的 redis 过期时间阈值 ms。
   * 默认 1000ms，redis.ttl 结果小于 1000ms 的就不会放到内存。0 代表有效 ttl 会全放。
   * @param {number} [payload.mem.max] 内存缓存keys数量上限
   * @param {Object} [payload.serializer] 自定义序列化器。不传时默认使用 JSON。
   * @param {boolean} [payload.serializer.binary=false] 是否用二进制方式读取 redis。
   * 为 true 时会调用 redisClient.getBuffer()。
   * @param {function} payload.serializer.serialize 将 executor 返回值转为 string、Buffer 或 Uint8Array
   * @param {function} payload.serializer.deserialize 将 redis 缓存值还原为返回值
   */
  constructor(payload) {
    const opt = defaultsDeep(payload, {
      redis: {
        host: '127.0.0.1',
        port: '6379',
        db: '12',
      },
      prefix: 'cache.',
      expire: 5,
      raw: false,
      mem: {
        max: 100,
        minRedisTtl: 1000,
      },
    });

    this.client = opt.redisClient || new Redis(opt.redis);
    this.prefix = opt.prefix;
    this.expire = opt.expire;
    this.serializer = opt.serializer;
    this.minRedisTtl = 0;
    this.mem = undefined;
    // 默认启用内存缓存
    if (opt.mem) {
      this.mem = new LRU(opt.mem);
      this.minRedisTtl = opt.mem.minRedisTtl
        ? opt.mem.minRedisTtl
        : this.minRedisTtl;
    }
  }

  /**
    * 使用redis为接口加缓存
    * @param {Object} payload
    * @param {string} payload.key 要查找的key
    * @param {function} payload.executor 如果未击中，要执行的方法
    * @param {number} payload.expire 失效时间, 单位s
    * @param {boolean} [payload.raw=false] 是否不用 decode/encode 数据
    * @param {Object} [payload.serializer] 自定义序列化器，优先级高于构造器 serializer。
    * raw 为 true 时会忽略 serializer。
    * @param {boolean} [payload.serializer.binary=false] 是否用 redisClient.getBuffer() 读取缓存，
    * 适用于 protobuf、MessagePack、CBOR、v8.serialize 等二进制格式
    * @param {function} payload.serializer.serialize 将 executor 返回值转为 string、Buffer 或 Uint8Array
    * @param {function} payload.serializer.deserialize 将 redis 缓存值还原为返回值
    * @param {boolean} [payload.mem=false] 是否对当前 key 启用内存缓存，默认不启用
    * @return {Promise.<Object>} 缓存中数据(击中) 或executor返回数据(未击中)
    * @example
    * 说明：以给getShops接口加缓存为例
    * 要点：executor为一个返回bluebird 的promise
    * getShops接口如下：
    * const getShops = (type) => {
    *   if (type === 0) {
    *     return Promise.reject(new Error('bad params'));
    *   }
    *   return Promise.resolve(['shop01', 'shop02']);
    * };
    *
    * 使用方式：
    * const Cacher = require('interface-cacher');

    * const cacher = new Cacher();
    *
    * const payload = {
    *   key: 'getShops',
    *   executor: getShops.bind(null, 1),
    *   expire: 100
    * };
    *
    * cacher.get(payload)
    *  .then((data) => {
    *    // process the data
    *  })
    *  .catch((err) => {
    *    // handle the exception when encounter with error
    *  });
    *
    * const data = await cacher.get({
    *   key: 'getShopes'
    *   executor: getShops.bind(null, 1),
    *   // 启用内存缓存，如果内存命中自己返回内存结果
    *   // 如果内存没有，就会获取 redis 结果，解析后放到内存中
    *   mem: true
    * }
    */
  async get(payload) {
    const {
      key, raw = false, executor, mem = false
    } = payload;
    // raw is the compatibility escape hatch: callers using plain redis strings
    // should not be affected by a default serializer configured on the instance.
    const serializer = raw ? undefined : payload.serializer || this.serializer;
    let expire = payload.expire || this.expire;
    if (expire < 0) {
      expire = this.expire;
    }

    const saveKey = this.prefix + key;
    let data;
    if (this.mem && mem === true) {
      data = this.mem.get(saveKey);
      if (data) {
        return data;
      }
    }

    const { client, minRedisTtl } = this;
    data = serializer && serializer.binary === true
      ? await client.getBuffer(saveKey)
      : await client.get(saveKey);
    if (data !== null && data !== 'undefined') {
      const dataParsed = decodeCacheValue(data, serializer, raw);
      if (this.mem && mem === true) {
        process.nextTick(async () => {
          const ttl = (await client.ttl(saveKey)) * 1000;
          if (ttl > minRedisTtl) {
            this.mem.set(saveKey, dataParsed, { ttl });
          }
        });
      }
      return dataParsed;
    }

    const result = await executor();
    if (!isUndefined(result)) {
      const value = encodeCacheValue(result, serializer, raw);
      await client.set(saveKey, value, 'ex', expire, 'nx');
    }

    return result;
  }

  /**
   * 删除指定缓存
   * @param {string} key 要删除key
   * @return {Promise.<number>} n 删除的key的数量, 同ioredis.del
   * */
  delete(key) {
    const saveKey = this.prefix + key;
    return this.client.del(saveKey);
  }
}

module.exports = Cacher;
