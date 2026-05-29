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

const createFilters = (size) => ({
  query: `cacheable catalog ${size}`,
  sort: 'recommended',
  currency: 'USD',
  categories: ['interfaces', 'storage', 'tooling'],
  tags: ['redis', 'serializer', 'benchmark'],
  minPriceCents: 1200,
  maxPriceCents: 98500,
  inStockOnly: true,
  freeShippingOnly: true,
});

const createOwner = (size) => ({
  id: `owner-${size}`,
  name: 'Interface Cacher Catalog',
  tier: 3,
  active: true,
  region: 'us-west',
  channels: ['api', 'web', 'partner'],
});

const createSummary = (itemCount) => ({
  itemCount,
  totalPages: Math.max(1, Math.ceil(itemCount / 24)),
  pageSize: 24,
  averageRating: 4.72,
  totalValueCents: itemCount * 7365,
  promotedCount: Math.max(1, Math.ceil(itemCount / 5)),
});

const createAttributes = (index) => [
  {
    name: 'material',
    value: ['steel', 'aluminum', 'polymer'][index % 3],
    confidence: 95 + (index % 4),
  },
  {
    name: 'finish',
    value: ['matte', 'satin', 'brushed'][index % 3],
    confidence: 91 + (index % 5),
  },
  {
    name: 'origin',
    value: ['warehouse-a', 'warehouse-b', 'warehouse-c'][index % 3],
    confidence: 89 + (index % 6),
  },
];

const createVariants = (index) => [1, 2].map((variantIndex) => ({
  id: `variant-${index}-${variantIndex}`,
  sku: `SKU-${1000 + index}-${variantIndex}`,
  color: ['graphite', 'white', 'amber'][variantIndex % 3],
  size: ['S', 'M', 'L'][index % 3],
  priceCents: 1900 + (index * 37) + (variantIndex * 125),
  inventory: 12 + ((index + variantIndex) % 30),
  available: true,
}));

const createItem = (index) => ({
  id: `item-${String(index).padStart(5, '0')}`,
  slug: `cache-fixture-item-${index}`,
  title: `Catalog cache fixture item ${index}`,
  rank: index + 1,
  quantity: 1 + (index % 9),
  priceCents: 2100 + (index * 53),
  active: true,
  rating: 4.1 + ((index % 8) / 10),
  seller: {
    id: `seller-${(index % 12) + 1}`,
    name: `Seller ${(index % 12) + 1}`,
    rating: 4.3 + ((index % 6) / 10),
    fulfilledByPlatform: true,
  },
  dimensions: {
    widthMm: 80 + (index % 20),
    heightMm: 45 + (index % 15),
    depthMm: 12 + (index % 8),
    weightGrams: 150 + (index % 50),
  },
  tags: [
    `category-${index % 5}`,
    `collection-${index % 7}`,
    'cacheable',
    'structured',
  ],
  attributes: createAttributes(index),
  variants: createVariants(index),
});

const createCatalogResponse = (size, itemCount) => ({
  id: `catalog-response-${size}`,
  version: 7,
  active: true,
  requestId: `req-${size}-serializer-benchmark`,
  generatedAt: '2026-05-29T00:00:00.000Z',
  locale: 'en-US',
  filters: createFilters(size),
  owner: createOwner(size),
  summary: createSummary(itemCount),
  items: Array.from({ length: itemCount }, (unused, index) => createItem(index + 1)),
});

const createFixtures = () => [
  { size: 'small', value: createCatalogResponse('small', 1) },
  { size: 'medium', value: createCatalogResponse('medium', 125) },
  { size: 'large', value: createCatalogResponse('large', 1278) },
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
      string region = 5;
      repeated string channels = 6;
    }

    message Filters {
      string query = 1;
      string sort = 2;
      string currency = 3;
      repeated string categories = 4;
      repeated string tags = 5;
      uint32 minPriceCents = 6;
      uint32 maxPriceCents = 7;
      bool inStockOnly = 8;
      bool freeShippingOnly = 9;
    }

    message Summary {
      uint32 itemCount = 1;
      uint32 totalPages = 2;
      uint32 pageSize = 3;
      double averageRating = 4;
      uint32 totalValueCents = 5;
      uint32 promotedCount = 6;
    }

    message Seller {
      string id = 1;
      string name = 2;
      double rating = 3;
      bool fulfilledByPlatform = 4;
    }

    message Dimensions {
      uint32 widthMm = 1;
      uint32 heightMm = 2;
      uint32 depthMm = 3;
      uint32 weightGrams = 4;
    }

    message Attribute {
      string name = 1;
      string value = 2;
      uint32 confidence = 3;
    }

    message Variant {
      string id = 1;
      string sku = 2;
      string color = 3;
      string size = 4;
      uint32 priceCents = 5;
      uint32 inventory = 6;
      bool available = 7;
    }

    message Item {
      string id = 1;
      string slug = 2;
      string title = 3;
      uint32 rank = 4;
      uint32 quantity = 5;
      uint32 priceCents = 6;
      bool active = 7;
      double rating = 8;
      Seller seller = 9;
      Dimensions dimensions = 10;
      repeated string tags = 11;
      repeated Attribute attributes = 12;
      repeated Variant variants = 13;
    }

    message Payload {
      string id = 1;
      uint32 version = 2;
      bool active = 3;
      string requestId = 4;
      string generatedAt = 5;
      string locale = 6;
      Filters filters = 7;
      Owner owner = 8;
      Summary summary = 9;
      repeated Item items = 10;
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

  return Object.keys(value)
    .sort()
    .map((key) => value[key])
    .reduce((sum, item) => (sum + checksumValue(item)) % MOD, 0);
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
