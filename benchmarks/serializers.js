/* eslint-disable import/no-dynamic-require, no-await-in-loop, no-console */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const v8 = require('v8');
const { createRequire } = require('module');
const { performance } = require('perf_hooks');

const Redis = require('ioredis');

const REDIS_OPTIONS = {
  host: '127.0.0.1',
  port: 6379,
  db: 12,
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
};
const REDIS_PREFIX = 'BENCH_SERIALIZER_';
const MOD = 1000000007;

const parseArgs = (argv) => argv.reduce((options, arg) => {
  const match = arg.match(/^--(warmup-ms|min-ms)=(\d+)$/);
  if (!match) {
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    ...options,
    [match[1]]: Number(match[2]),
  };
}, {
  'warmup-ms': 100,
  'min-ms': 500,
});

const optionalRequirePaths = () => process.env.PATH
  .split(path.delimiter)
  .filter((binPath) => binPath.endsWith(`${path.sep}.bin`))
  .map((binPath) => path.dirname(binPath));

const createOptionalRequire = (nodeModulesPath) => (
  createRequire(path.join(nodeModulesPath, '_optional.js'))
);

const requireOptional = (id) => {
  try {
    return require(id);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') {
      throw err;
    }

    const required = optionalRequirePaths()
      .map((nodeModulesPath) => {
        try {
          return createOptionalRequire(nodeModulesPath)(id);
        } catch (pathErr) {
          return undefined;
        }
      })
      .find(Boolean);

    if (required) {
      return required;
    }

    throw err;
  }
};

const resolveOptional = (id) => {
  try {
    return require.resolve(id);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') {
      throw err;
    }

    const resolved = optionalRequirePaths()
      .map((nodeModulesPath) => {
        try {
          return createOptionalRequire(nodeModulesPath).resolve(id);
        } catch (pathErr) {
          return undefined;
        }
      })
      .find(Boolean);

    if (resolved) {
      return resolved;
    }

    throw err;
  }
};

const packageVersion = (id) => {
  const entry = resolveOptional(id);
  const { root } = path.parse(entry);
  const findPackage = (dir) => {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name === id) {
        return pkg.version;
      }
    }

    if (dir === root) {
      return 'unknown';
    }

    return findPackage(path.dirname(dir));
  };

  return findPackage(path.dirname(entry));
};

const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value));

const createBasePayload = (size) => ({
  id: `payload-${size}`,
  version: 7,
  active: true,
  score: 99.5,
  owner: {
    id: 'owner-001',
    name: 'interface-cacher',
    tier: 3,
    active: true,
  },
  items: [
    {
      id: 'item-001',
      index: 1,
      quantity: 2,
      price: 12.5,
      active: true,
      tags: ['redis', 'cache', 'codec'],
    },
    {
      id: 'item-002',
      index: 2,
      quantity: 5,
      price: 37.25,
      active: true,
      tags: ['serializer', 'benchmark'],
    },
    {
      id: 'item-003',
      index: 3,
      quantity: 8,
      price: 101.75,
      active: true,
      tags: ['node', 'binary', 'json'],
    },
  ],
  padding: '',
});

const createSizedPayload = (size, targetBytes) => {
  const base = createBasePayload(size);
  const paddingLength = targetBytes - jsonBytes(base);
  if (paddingLength < 0) {
    throw new Error(`${size} base payload exceeds ${targetBytes} bytes`);
  }

  const payload = {
    ...base,
    padding: 'x'.repeat(paddingLength),
  };
  assert.strictEqual(jsonBytes(payload), targetBytes);
  return payload;
};

const createFixtures = () => [
  { size: 'small', value: createSizedPayload('small', 1024) },
  { size: 'medium', value: createSizedPayload('medium', 102400) },
  { size: 'large', value: createSizedPayload('large', 1048576) },
].map((fixture) => ({
  ...fixture,
  jsonBytes: jsonBytes(fixture.value),
}));

const createProtobufPayload = (protobuf) => {
  const { root } = protobuf.parse(`
    syntax = "proto3";

    message Owner {
      string id = 1;
      string name = 2;
      uint32 tier = 3;
      bool active = 4;
    }

    message Item {
      string id = 1;
      uint32 index = 2;
      uint32 quantity = 3;
      double price = 4;
      bool active = 5;
      repeated string tags = 6;
    }

    message Payload {
      string id = 1;
      uint32 version = 2;
      bool active = 3;
      double score = 4;
      Owner owner = 5;
      repeated Item items = 6;
      string padding = 7;
    }
  `).root;

  return root.lookupType('Payload');
};

const createCodecs = () => {
  const protobuf = requireOptional('protobufjs');
  const { decode, encode } = requireOptional('@msgpack/msgpack');
  const { Decoder, Encoder } = requireOptional('cbor-x');
  const Payload = createProtobufPayload(protobuf);
  const encoder = new Encoder();
  const decoder = new Decoder();

  return [
    {
      id: 'json',
      label: 'JSON',
      version: 'built-in',
      binary: false,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    },
    {
      id: 'protobufjs',
      label: 'protobufjs',
      version: packageVersion('protobufjs'),
      binary: true,
      serialize: (value) => Payload.encode(Payload.create(value)).finish(),
      deserialize: (value) => Payload.toObject(Payload.decode(value), {
        defaults: false,
      }),
    },
    {
      id: 'messagepack',
      label: 'MessagePack',
      version: packageVersion('@msgpack/msgpack'),
      binary: true,
      serialize: encode,
      deserialize: decode,
    },
    {
      id: 'cbor',
      label: 'CBOR',
      version: packageVersion('cbor-x'),
      binary: true,
      serialize: (value) => encoder.encode(value),
      deserialize: (value) => decoder.decode(value),
    },
    {
      id: 'v8',
      label: 'Node v8',
      version: process.versions.v8,
      binary: true,
      serialize: v8.serialize,
      deserialize: v8.deserialize,
    },
  ];
};

const serializedBytes = (value) => (
  typeof value === 'string'
    ? Buffer.byteLength(value)
    : Buffer.byteLength(value)
);

const toRedisValue = (value) => {
  if (Buffer.isBuffer(value) || typeof value === 'string') {
    return value;
  }

  return value instanceof Uint8Array
    ? Buffer.from(value)
    : value;
};

const checksumValue = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'string') {
    return value.length;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return value.length;
  }

  if (Array.isArray(value)) {
    return value.reduce((sum, item) => (sum + checksumValue(item)) % MOD, 0);
  }

  return [
    value.id,
    value.version,
    value.active,
    value.score,
    value.owner,
    value.items,
    value.padding,
  ].reduce((sum, item) => (sum + checksumValue(item)) % MOD, 0);
};

const addChecksum = (checksum, value) => (
  (checksum + checksumValue(value)) % MOD
);

const maybeGc = () => {
  if (global.gc) {
    global.gc();
  }
};

const measureSync = (fn, options) => {
  const warmupEnd = performance.now() + options['warmup-ms'];
  let checksum = 0;
  while (performance.now() < warmupEnd) {
    checksum = addChecksum(checksum, fn());
  }

  maybeGc();

  const start = performance.now();
  const end = start + options['min-ms'];
  let count = 0;
  while (performance.now() < end) {
    checksum = addChecksum(checksum, fn());
    count += 1;
  }

  const elapsedMs = performance.now() - start;
  return {
    count,
    checksum,
    elapsedMs,
    opsSec: (count / elapsedMs) * 1000,
    avgMs: elapsedMs / count,
  };
};

const measureAsync = async (fn, options) => {
  const warmupEnd = performance.now() + options['warmup-ms'];
  let checksum = 0;
  while (performance.now() < warmupEnd) {
    checksum = addChecksum(checksum, await fn());
  }

  maybeGc();

  const start = performance.now();
  const end = start + options['min-ms'];
  let count = 0;
  while (performance.now() < end) {
    checksum = addChecksum(checksum, await fn());
    count += 1;
  }

  const elapsedMs = performance.now() - start;
  return {
    count,
    checksum,
    elapsedMs,
    opsSec: (count / elapsedMs) * 1000,
    avgMs: elapsedMs / count,
  };
};

const formatNumber = (value, digits = 2) => (
  Number.isFinite(value) ? value.toFixed(digits) : 'n/a'
);

const formatInteger = (value) => Math.round(value).toLocaleString('en-US');

const formatTable = (rows, columns) => {
  const matrix = [
    columns.map((column) => column.title),
    ...rows.map((row) => columns.map((column) => String(row[column.key]))),
  ];
  const widths = columns.map((column, index) => (
    Math.max(...matrix.map((row) => row[index].length))
  ));
  const formatRow = (row) => `| ${row
    .map((cell, index) => cell.padEnd(widths[index]))
    .join(' | ')} |`;

  return [
    formatRow(matrix[0]),
    formatRow(widths.map((width) => '-'.repeat(width))),
    ...matrix.slice(1).map(formatRow),
  ].join('\n');
};

const assertRoundTrip = (fixtures, codecs) => {
  fixtures.forEach((fixture) => {
    codecs.forEach((codec) => {
      const serialized = toRedisValue(codec.serialize(fixture.value));
      assert.deepStrictEqual(codec.deserialize(serialized), fixture.value);
    });
  });
};

const createKeys = (fixtures, codecs) => fixtures.reduce((keys, fixture) => [
  ...keys,
  ...codecs.map((codec) => `${REDIS_PREFIX}${fixture.size}_${codec.id}`),
], []);

const setupRedisValues = async (redis, fixtures, codecs) => {
  const keys = createKeys(fixtures, codecs);
  await redis.del(...keys);

  const entries = fixtures.reduce((allEntries, fixture) => [
    ...allEntries,
    ...codecs.map((codec) => {
      const serialized = toRedisValue(codec.serialize(fixture.value));
      return {
        key: `${REDIS_PREFIX}${fixture.size}_${codec.id}`,
        codec,
        fixture,
        serialized,
        bytes: serializedBytes(serialized),
      };
    }),
  ], []);

  for (let index = 0; index < entries.length; index += 1) {
    await redis.set(entries[index].key, entries[index].serialized);
  }

  return entries;
};

const codecRows = (fixtures, codecs, options) => fixtures.reduce((rows, fixture) => [
  ...rows,
  ...codecs.reduce((codecRowsForFixture, codec) => {
    const serialized = toRedisValue(codec.serialize(fixture.value));
    const bytes = serializedBytes(serialized);
    const serializeResult = measureSync(() => codec.serialize(fixture.value), options);
    const deserializeResult = measureSync(() => codec.deserialize(serialized), options);

    return [
      ...codecRowsForFixture,
      {
        size: fixture.size,
        codec: codec.label,
        operation: 'serialize',
        opsSec: formatInteger(serializeResult.opsSec),
        avgMs: formatNumber(serializeResult.avgMs, 4),
        bytes: formatInteger(bytes),
        checksum: serializeResult.checksum,
      },
      {
        size: fixture.size,
        codec: codec.label,
        operation: 'deserialize',
        opsSec: formatInteger(deserializeResult.opsSec),
        avgMs: formatNumber(deserializeResult.avgMs, 4),
        bytes: formatInteger(bytes),
        checksum: deserializeResult.checksum,
      },
    ];
  }, []),
], []);

const redisRows = async (redis, entries, options) => {
  const rows = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const result = await measureAsync(async () => {
      const cached = entry.codec.binary
        ? await redis.getBuffer(entry.key)
        : await redis.get(entry.key);
      return entry.codec.deserialize(cached);
    }, options);

    rows.push({
      size: entry.fixture.size,
      codec: entry.codec.label,
      operation: entry.codec.binary ? 'GETBUFFER + deserialize' : 'GET + parse',
      opsSec: formatInteger(result.opsSec),
      avgMs: formatNumber(result.avgMs, 4),
      bytes: formatInteger(entry.bytes),
      checksum: result.checksum,
    });
  }

  return rows;
};

const printHeader = (fixtures, codecs, options) => {
  console.log('# serializer benchmark');
  console.log(`node: ${process.version}`);
  console.log(`platform: ${process.platform} ${process.arch}`);
  console.log(`warmup-ms: ${options['warmup-ms']}`);
  console.log(`min-ms: ${options['min-ms']}`);
  console.log(`redis: ${REDIS_OPTIONS.host}:${REDIS_OPTIONS.port} db ${REDIS_OPTIONS.db}`);
  console.log(`packages: ${codecs.map((codec) => `${codec.label} ${codec.version}`).join(', ')}`);
  console.log(`object JSON bytes: ${fixtures.map((fixture) => `${fixture.size}=${fixture.jsonBytes}`).join(', ')}`);
  console.log('');
};

const printRows = (title, rows) => {
  console.log(`## ${title}`);
  console.log(formatTable(rows, [
    { key: 'size', title: 'size' },
    { key: 'codec', title: 'codec' },
    { key: 'operation', title: 'operation' },
    { key: 'opsSec', title: 'ops/sec' },
    { key: 'avgMs', title: 'avg ms' },
    { key: 'bytes', title: 'serialized bytes' },
  ]));
  console.log('');
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const fixtures = createFixtures();
  const codecs = createCodecs();
  assertRoundTrip(fixtures, codecs);
  printHeader(fixtures, codecs, options);

  const codecOnlyRows = codecRows(fixtures, codecs, options);
  let measuredRows = codecOnlyRows;
  printRows('codec-only', codecOnlyRows);

  const redis = new Redis(REDIS_OPTIONS);
  const keys = createKeys(fixtures, codecs);
  try {
    await redis.ping();
    const entries = await setupRedisValues(redis, fixtures, codecs);
    const cacheHitRows = await redisRows(redis, entries, options);
    measuredRows = [
      ...measuredRows,
      ...cacheHitRows,
    ];
    printRows('redis-hit', cacheHitRows);
  } finally {
    await redis.del(...keys).catch(() => undefined);
    redis.disconnect();
  }

  const checksum = measuredRows.reduce((sum, row) => (
    (sum + row.checksum) % MOD
  ), 0);
  if (process.env.BENCH_CHECKSUM === '1') {
    console.log(`checksum: ${checksum}`);
  }
};

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exitCode = 1;
});
