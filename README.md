# token-bucket-limiter-redis

Efficient Rate Limiter using Token Bucket Algorithm + Redis

- Implemented using the token bucket algorithm.
- Supports both in-memory and Redis-based storage, making it suitable for distributed rate limiting.
- High performance: Token production is based on the time elapsed since the last request, not a fixed timer.

## Installation

```bash
npm install token-bucket-limiter-redis --save
```

## Import

```js
import { RateLimiterTokenBucket, RateLimiterTokenBucketRedis } from 'token-bucket-limiter-redis';
```

## Usage

### In-memory Global Rate Limiter

```js
const globalRateLimiter = new RateLimiterTokenBucket({
    tokenPerSecond: 100,
    capacity: 1000,
  });

const globalTokens = globalRateLimiter.getToken();

if (globalTokens > 0) {
  // Pass
}
```

### In-memory Single-Node Rate Limiter

```js
const globalRateLimiter = new RateLimiterTokenBucket({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
  });

const key = ip + uid; // Identifies user information with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Pass
}
```

### Redis-based Global Rate Limiter with External Redis Client

Supports distributed rate limiting by providing an external Redis client (ioredis).

```js
import Redis from 'ioredis';

const redis = new Redis({});

const globalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 100,
    capacity: 1000,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
    redisClient: redis,
  });

const key = 'myproject'; // Use a globally unique key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Pass
}
```

### Redis-based Single-Node Rate Limiter with External Redis Client

Supports distributed rate limiting by providing an external Redis client (ioredis).

```js
import Redis from 'ioredis';

const redis = new Redis({});

const globalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
    redisClient: redis,
  });

const key = ip + uid; // Identifies user information with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Pass
}
```

### Redis-based Single-Node Rate Limiter with Built-in Redis

Only requires the configuration of Redis options (ioredis) externally.

```js
const redisOptions = {
  port: 6379,          // Redis port
  host: 'localhost',   // Redis hostname
  password: 'password' // Your Redis password if applicable
  db: 0,
};

const globalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
    redisOptions: redis,
  });

const key = ip + uid; // Identifies user information with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Pass
}
```

### Adding In-Memory Blocking Strategy

The in-memory blocking strategy can protect the Redis server against DDoS attacks.

```js
const redisOptions = {
  port: 6379,          // Redis port
  host: 'localhost',   // Redis hostname
  password: 'password' // Your Redis password if applicable
  db: 0,
};

const globalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
    redisOptions: redis,

    // In-memory blocking strategy (calculates requests only for the current server, not distributed)
    inMemoryBlockOnConsumed: 50, // If the number of tokens consumed for a key in one minute exceeds 50, block requests for that key in memory, without making a Redis request, to prevent DDoS attacks
    inMemoryBlockDuration: 10, // Block duration in seconds
  });

const key = ip + uid; // Identifies user information with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Pass
}
```

### Adding Insurance Strategy to Automatically Use In-Memory Limiter when Redis Fails

```js
const redisOptions = {
  port: 6379,          // Redis port
  host: 'localhost',   // Redis hostname
  password: 'password' // Your Redis password if applicable
  db: 0,
};

const globalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
    redisOptions: redis,

    // In-memory blocking strategy
    inMemoryBlockOnConsumed: 50, // If the number of tokens consumed for a key in one minute exceeds 50, block requests for that key in memory, without making a Redis request, to prevent DDoS attacks
    inMemoryBlockDuration: 10, // Block duration in seconds

    // Insurance strategy
    insuranceLimiter: true,
  });

const key = ip + uid; // Identifies user information with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Pass
}
```

## Notes

1. In-memory limiters do not support cluster mode; parameters need to be adjusted accordingly in cluster mode.
