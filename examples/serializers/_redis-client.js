const Redis = require('ioredis');

const createRedisClient = () => new Redis({
  host: '127.0.0.1',
  port: '6379',
  db: '12',
});

module.exports = createRedisClient;
