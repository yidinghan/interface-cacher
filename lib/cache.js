const defaultsDeep = require('lodash.defaultsdeep');
const isUndefined = require('lodash.isundefined');
const Redis = require('ioredis');
const LRU = require('lru-cache');

class Cacher {
  /**
   * @param payload
   * @param {Object} [payload.redis] 用于redis的连接
   * @param {string} [payload.redis.host=localhost] host ip of redis
   * @param {number} [payload.redis.port=6379] port of redis
   * @param {number} [payload.redis.db=12] cache db of redis
   * @param {string} [payload.prefix=cache.] key的默认前缀
   * @param {number} [payload.expire=5] key的有效期，单位s
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
        ttl: 60 * 10 * 1000,
        // 最小可放内存的 redis 过期时间阈值 ms
        minRedisTtl: 1000,
      },
    });

    this.client = new Redis(opt.redis);
    this.prefix = opt.prefix;
    this.expire = opt.expire;
    this.minRedisTtl = 0;
    this.mem = undefined;
    // 默认启用内存缓存
    if (!!opt.mem) {
      this.mem = new LRU(opt.mem);
      this.minRedisTtl = !!opt.mem.minRedisTtl
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
    * cache.get(payload)
    *  .then((data) => {
    *    // process the data
    *  })
    *  .catch((err) => {
    *    // handle the exception when encounter with error
    *  });
    */
  async get(payload) {
    const { key, raw = false, executor, mem = false } = payload;
    let expire = payload.expire || this.expire;
    if (expire < 0) {
      expire = this.expire;
    }

    const saveKey = this.prefix + key;
    let data = undefined;
    if (this.mem && mem === true) {
      data = this.mem.get(saveKey);
      if (data) {
        return data;
      }
    }

    const { client, minRedisTtl } = this;
    data = await client.get(saveKey);
    if (data !== null && data !== 'undefined') {
      const dataParsed = raw ? data : JSON.parse(data);
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
      const value = raw ? result : JSON.stringify(result);
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
