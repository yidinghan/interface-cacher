# interface-cacher

[![master](https://github.com/yidinghan/interface-cacher/actions/workflows/node.js.yml/badge.svg)](https://github.com/yidinghan/interface-cacher/actions/workflows/node.js.yml)

A simple cacher based on ioredis.

# usage

```sh
npm i @playding/redis-cacher
```

```js
const Cacher = require('@playding/redis-cacher');
const cacher = new Cacher();

const data = await cacher.get({
  key: 'ding',
  executor: async () => {
    // logic
    return 'dingding;
  },
});
```

# changelogs

## 20220913 lru mem cache

```js
const data = await cache.get({
  key: 'ding',
  executor: () => 'dingding',
  // 启用内存缓存
  mem: true,
});
```

有些场景下，缓存数据是静态的。例如首页广告位，在运营配置后一般短时间不会改变，也不会随着入参变化。

在之前的版本中，数据从执行函数中生成后，通过 json stringify 变为 string 放到 redis 中。而后的其他服务实例可以通过固定的 key 从 redis 获取该 string，反过来通过 json parse 解析到实际数据如 object|array。

对于静态数据，此时反序列化成为了最耗时的操作，特别是对于大对象。通过内存二级缓存，减少 json parse，降低 cpu 时间，提速操作。

需要注意的是，该特性是通过增加内存资源消耗来实现，所以如果 mem.max 放的很高，或者 cache obj 很大，会带来比较明显的内存使用增加。

# serializer

默认情况下，缓存值仍然通过 `JSON.stringify()` 写入 Redis，并在命中时通过 `JSON.parse()` 还原。可以在构造器或单次 `get()` 中传入 `serializer` 来改用 protobuf、MessagePack、CBOR、Node `v8.serialize` 等格式：

```js
const serializer = {
  binary: true,
  serialize: (value) => encode(value),
  deserialize: (cachedValue) => decode(cachedValue),
};

const cacher = new Cacher({ serializer });
const data = await cacher.get({
  key: 'ding',
  executor: async () => ({ name: 'ding' }),
});
```

`payload.serializer` 会覆盖构造器上的默认 `serializer`。`raw: true` 优先级最高；同时传 `raw` 和 `serializer` 时会忽略 `serializer`，保持原来的字符串读写行为。

当 `serializer.binary === true` 时，Redis 命中读取会调用 `redisClient.getBuffer(key)`，`serialize()` 可以返回 `Buffer`、`Uint8Array` 或字符串，其中 `Uint8Array` 会在写入前转成 `Buffer`。如果传入自定义 `redisClient`，它必须支持 `getBuffer()`；旧版 ioredis 不应启用会禁用 buffer 方法的 `dropBufferSupport`。

本库不内置安装 protobuf、MessagePack、CBOR 等 codec，调用方按业务需要自行选择依赖。仓库提供了可选兼容示例，运行时同样需要本机 Redis `127.0.0.1:6379`、DB `12`：

```sh
npx -p ava -p protobufjs -p @msgpack/msgpack -p cbor-x ava examples/serializers/*.test.js
```

## serializer benchmark

仓库提供了一个独立 benchmark，用同一批对象对比 JSON、protobufjs、MessagePack、CBOR 和 Node `v8.serialize` 的性能。它会输出两组结果：纯 codec 的 serialize/deserialize 性能，以及预写 Redis 后真实 cache-hit 读路径的 `GET + parse` 或 `GETBUFFER + deserialize` 性能。

```sh
npx -p protobufjs -p @msgpack/msgpack -p cbor-x node --expose-gc benchmarks/serializers.js
```

默认会生成 small、medium、large 三个确定性对象，其中 large 对象的 JSON string 精确为 1 MiB。Redis benchmark 使用本机 `127.0.0.1:6379`、DB `12`，key 前缀为 `BENCH_SERIALIZER_`，只删除 benchmark 自己写入的 key。

结果会受 Node 版本、CPU、codec 包版本和本机 Redis 状态影响。可以用 `--warmup-ms=... --min-ms=...` 覆盖默认的 `100ms` warmup 和 `500ms` 最小测量时间，例如：

```sh
npx -p protobufjs -p @msgpack/msgpack -p cbor-x node --expose-gc benchmarks/serializers.js --warmup-ms=10 --min-ms=50
```

一次本机完整 benchmark 结果如下，环境为 Node `v24.14.0`、darwin arm64、Redis `127.0.0.1:6379` DB `12`，codec 包版本为 protobufjs `8.4.2`、MessagePack `3.1.3`、CBOR `1.6.4`、Node v8 `13.6.233.17-node.41`。下面的图都以 ops/sec 为指标，越长越快；百分比是相对 JSON 的变化。

### Cache-hit read path

真实 Redis 命中路径里，小对象主要受 Redis round-trip 影响，codec 差异很小；对象越大，反序列化成本越能被看出来。

**small, 1 KiB JSON**

| codec | ops/sec | vs JSON | chart |
| --- | ---: | ---: | --- |
| CBOR | 3,994 | +0.4% | ██████████████████████████████ |
| JSON | 3,977 | baseline | ██████████████████████████████ |
| Node v8 | 3,922 | -1.4% | █████████████████████████████ |
| protobufjs | 3,920 | -1.4% | █████████████████████████████ |
| MessagePack | 3,868 | -2.7% | █████████████████████████████ |

**medium, 100 KiB JSON**

| codec | ops/sec | vs JSON | chart |
| --- | ---: | ---: | --- |
| CBOR | 1,607 | +7.0% | ██████████████████████████████ |
| Node v8 | 1,600 | +6.5% | ██████████████████████████████ |
| protobufjs | 1,569 | +4.5% | █████████████████████████████ |
| MessagePack | 1,551 | +3.3% | █████████████████████████████ |
| JSON | 1,502 | baseline | ████████████████████████████ |

**large, 1 MiB JSON**

| codec | ops/sec | vs JSON | chart |
| --- | ---: | ---: | --- |
| MessagePack | 251 | +11.6% | ██████████████████████████████ |
| protobufjs | 244 | +8.4% | █████████████████████████████ |
| CBOR | 242 | +7.6% | █████████████████████████████ |
| Node v8 | 238 | +5.8% | ████████████████████████████ |
| JSON | 225 | baseline | ███████████████████████████ |

### Codec-only deserialize

这组去掉 Redis，只看 CPU 反序列化。对 100 KiB 和 1 MiB 对象，protobufjs 和 MessagePack 的 deserialize 明显快于 JSON；小对象上 JSON 仍然很难被拉开。

| size | fastest | JSON ops/sec | fastest ops/sec | fastest vs JSON |
| --- | --- | ---: | ---: | ---: |
| small | JSON | 442,833 | 442,833 | baseline |
| medium | protobufjs | 26,399 | 161,916 | 6.13x |
| large | protobufjs | 2,164 | 21,955 | 10.15x |

**large deserialize detail**

| codec | ops/sec | vs JSON | chart |
| --- | ---: | ---: | --- |
| protobufjs | 21,955 | 10.15x | ██████████████████████████████ |
| MessagePack | 21,900 | 10.12x | ██████████████████████████████ |
| Node v8 | 7,389 | 3.41x | ██████████ |
| CBOR | 5,929 | 2.74x | ████████ |
| JSON | 2,164 | baseline | ███ |

### Codec-only serialize

写入 miss 路径时，large 对象的 serialize 成本差异很大：Node v8 和 CBOR 最快，MessagePack 在这次环境里最慢。

| size | fastest | JSON ops/sec | fastest ops/sec | fastest vs JSON |
| --- | --- | ---: | ---: | ---: |
| small | JSON | 753,043 | 753,043 | baseline |
| medium | CBOR | 25,048 | 155,900 | 6.22x |
| large | Node v8 | 2,048 | 28,861 | 14.09x |

**large serialize detail**

| codec | ops/sec | vs JSON | chart |
| --- | ---: | ---: | --- |
| Node v8 | 28,861 | 14.09x | ██████████████████████████████ |
| CBOR | 18,792 | 9.18x | ████████████████████ |
| protobufjs | 4,671 | 2.28x | █████ |
| JSON | 2,048 | baseline | ██ |
| MessagePack | 486 | -76.3% | █ |

### Payload size

这批对象里各 codec 的 Redis payload 大小差异不大；protobufjs 在 small 对象上压缩最明显，但到 1 MiB 主要由 padding 字符串主导。

| size | JSON bytes | smallest codec | smallest bytes | saved vs JSON |
| --- | ---: | --- | ---: | ---: |
| small | 1,024 | protobufjs | 769 | 24.9% |
| medium | 102,400 | protobufjs | 102,146 | 0.2% |
| large | 1,048,576 | protobufjs | 1,048,322 | 0.02% |

<details>
<summary>Raw benchmark tables</summary>

#### codec-only

| size | codec | operation | ops/sec | avg ms | serialized bytes |
| --- | --- | --- | ---: | ---: | ---: |
| small | JSON | serialize | 753,043 | 0.0013 | 1,024 |
| small | JSON | deserialize | 442,833 | 0.0023 | 1,024 |
| small | protobufjs | serialize | 452,563 | 0.0022 | 769 |
| small | protobufjs | deserialize | 431,931 | 0.0023 | 769 |
| small | MessagePack | serialize | 266,651 | 0.0038 | 915 |
| small | MessagePack | deserialize | 338,400 | 0.0030 | 915 |
| small | CBOR | serialize | 577,277 | 0.0017 | 870 |
| small | CBOR | deserialize | 388,518 | 0.0026 | 870 |
| small | Node v8 | serialize | 449,915 | 0.0022 | 994 |
| small | Node v8 | deserialize | 303,371 | 0.0033 | 994 |
| medium | JSON | serialize | 25,048 | 0.0399 | 102,400 |
| medium | JSON | deserialize | 26,399 | 0.0379 | 102,400 |
| medium | protobufjs | serialize | 38,655 | 0.0259 | 102,146 |
| medium | protobufjs | deserialize | 161,916 | 0.0062 | 102,146 |
| medium | MessagePack | serialize | 3,625 | 0.2759 | 102,293 |
| medium | MessagePack | deserialize | 140,545 | 0.0071 | 102,293 |
| medium | CBOR | serialize | 155,900 | 0.0064 | 102,248 |
| medium | CBOR | deserialize | 104,566 | 0.0096 | 102,248 |
| medium | Node v8 | serialize | 148,367 | 0.0067 | 102,371 |
| medium | Node v8 | deserialize | 106,270 | 0.0094 | 102,371 |
| large | JSON | serialize | 2,048 | 0.4882 | 1,048,576 |
| large | JSON | deserialize | 2,164 | 0.4622 | 1,048,576 |
| large | protobufjs | serialize | 4,671 | 0.2141 | 1,048,322 |
| large | protobufjs | deserialize | 21,955 | 0.0455 | 1,048,322 |
| large | MessagePack | serialize | 486 | 2.0585 | 1,048,469 |
| large | MessagePack | deserialize | 21,900 | 0.0457 | 1,048,469 |
| large | CBOR | serialize | 18,792 | 0.0532 | 1,048,424 |
| large | CBOR | deserialize | 5,929 | 0.1687 | 1,048,424 |
| large | Node v8 | serialize | 28,861 | 0.0346 | 1,048,547 |
| large | Node v8 | deserialize | 7,389 | 0.1353 | 1,048,547 |

#### redis-hit

| size | codec | operation | ops/sec | avg ms | serialized bytes |
| --- | --- | --- | ---: | ---: | ---: |
| small | JSON | GET + parse | 3,977 | 0.2514 | 1,024 |
| small | protobufjs | GETBUFFER + deserialize | 3,920 | 0.2551 | 769 |
| small | MessagePack | GETBUFFER + deserialize | 3,868 | 0.2585 | 915 |
| small | CBOR | GETBUFFER + deserialize | 3,994 | 0.2504 | 870 |
| small | Node v8 | GETBUFFER + deserialize | 3,922 | 0.2550 | 994 |
| medium | JSON | GET + parse | 1,502 | 0.6657 | 102,400 |
| medium | protobufjs | GETBUFFER + deserialize | 1,569 | 0.6374 | 102,146 |
| medium | MessagePack | GETBUFFER + deserialize | 1,551 | 0.6448 | 102,293 |
| medium | CBOR | GETBUFFER + deserialize | 1,607 | 0.6222 | 102,248 |
| medium | Node v8 | GETBUFFER + deserialize | 1,600 | 0.6250 | 102,371 |
| large | JSON | GET + parse | 225 | 4.4417 | 1,048,576 |
| large | protobufjs | GETBUFFER + deserialize | 244 | 4.0989 | 1,048,322 |
| large | MessagePack | GETBUFFER + deserialize | 251 | 3.9890 | 1,048,469 |
| large | CBOR | GETBUFFER + deserialize | 242 | 4.1280 | 1,048,424 |
| large | Node v8 | GETBUFFER + deserialize | 238 | 4.2037 | 1,048,547 |

</details>

## protobufjs

```js
const protobuf = require('protobufjs');

const CacheValue = new protobuf.Type('CacheValue')
  .add(new protobuf.Field('name', 1, 'string'))
  .add(new protobuf.Field('count', 2, 'uint32'));

const serializer = {
  binary: true,
  serialize: (value) => CacheValue.encode(CacheValue.create(value)).finish(),
  deserialize: (value) => CacheValue.toObject(CacheValue.decode(value)),
};
```

## MessagePack

```js
const { decode, encode } = require('@msgpack/msgpack');

const serializer = {
  binary: true,
  serialize: encode,
  deserialize: decode,
};
```

## CBOR

```js
const { Decoder, Encoder } = require('cbor-x');

const encoder = new Encoder();
const decoder = new Decoder();
const serializer = {
  binary: true,
  serialize: (value) => encoder.encode(value),
  deserialize: (value) => decoder.decode(value),
};
```

## Node v8

```js
const v8 = require('v8');

const serializer = {
  binary: true,
  serialize: v8.serialize,
  deserialize: v8.deserialize,
};
```

# JSDoc

<!-- Generated by documentation.js. Update this documentation by updating the source code. -->

### Table of Contents

*   [constructor](#constructor)
    *   [Parameters](#parameters)
*   [get](#get)
    *   [Parameters](#parameters-1)
    *   [Examples](#examples)
*   [delete](#delete)
    *   [Parameters](#parameters-2)

## constructor

### Parameters

*   `payload` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**&#x20;

    *   `payload.redis` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** 用于redis的连接

        *   `payload.redis.host` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** host ip of redis (optional, default `localhost`)
        *   `payload.redis.port` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** port of redis (optional, default `6379`)
        *   `payload.redis.db` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** cache db of redis (optional, default `12`)
    *   `payload.redisClient` **IORedis.AbstractConnector?** client like cluster or sentinel redis
    *   `payload.prefix` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** key的默认前缀 (optional, default `cache.`)
    *   `payload.expire` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** key的有效期，单位s (optional, default `5`)
    *   `payload.mem` **([object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object) | [boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean))?** 内存缓存配置，传false表示不启用。全部参数可以看这个[文档说明](https://github.com/isaacs/node-lru-cache#usage)

        *   `payload.mem.minRedisTtl` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** 最小可放内存的 redis 过期时间阈值 ms。
            默认 1000ms，redis.ttl 结果小于 1000ms 的就不会放到内存。0 代表有效 ttl 会全放。
        *   `payload.mem.max` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)?** 内存缓存keys数量上限
    *   `payload.serializer` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** 自定义序列化器。不传时默认使用 JSON。

        *   `payload.serializer.binary` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** 是否用二进制方式读取 redis。
            为 true 时会调用 redisClient.getBuffer()。 (optional, default `false`)
        *   `payload.serializer.serialize` **[function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** 将 executor 返回值转为 string、Buffer 或 Uint8Array
        *   `payload.serializer.deserialize` **[function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** 将 redis 缓存值还原为返回值

## get

使用redis为接口加缓存

### Parameters

*   `payload` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)**&#x20;

    *   `payload.key` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 要查找的key
    *   `payload.executor` **[function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** 如果未击中，要执行的方法
    *   `payload.expire` **[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)** 失效时间, 单位s
    *   `payload.raw` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** 是否不用 decode/encode 数据 (optional, default `false`)
    *   `payload.serializer` **[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)?** 自定义序列化器，优先级高于构造器 serializer。
        raw 为 true 时会忽略 serializer。

        *   `payload.serializer.binary` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** 是否用 redisClient.getBuffer() 读取缓存，
            适用于 protobuf、MessagePack、CBOR、v8.serialize 等二进制格式 (optional, default `false`)
        *   `payload.serializer.serialize` **[function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** 将 executor 返回值转为 string、Buffer 或 Uint8Array
        *   `payload.serializer.deserialize` **[function](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Statements/function)** 将 redis 缓存值还原为返回值
    *   `payload.mem` **[boolean](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Boolean)** 是否对当前 key 启用内存缓存，默认不启用 (optional, default `false`)

### Examples

```javascript
说明：以给getShops接口加缓存为例
要点：executor为一个返回bluebird 的promise
getShops接口如下：
const getShops = (type) => {
  if (type === 0) {
    return Promise.reject(new Error('bad params'));
  }
  return Promise.resolve(['shop01', 'shop02']);
};

使用方式：
const Cacher = require('interface-cacher');

const cacher = new Cacher();

const payload = {
  key: 'getShops',
  executor: getShops.bind(null, 1),
  expire: 100
};

cacher.get(payload)
 .then((data) => {
   // process the data
 })
 .catch((err) => {
   // handle the exception when encounter with error
 });

const data = await cacher.get({
  key: 'getShopes'
  executor: getShops.bind(null, 1),
  // 启用内存缓存，如果内存命中自己返回内存结果
  // 如果内存没有，就会获取 redis 结果，解析后放到内存中
  mem: true
}
```

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[Object](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object)>** 缓存中数据(击中) 或executor返回数据(未击中)

## delete

删除指定缓存

### Parameters

*   `key` **[string](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String)** 要删除key

Returns **[Promise](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Promise)<[number](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Number)>** n 删除的key的数量, 同ioredis.del
