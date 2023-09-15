# token-bucket-limiter-redis

Efficient Rate Limiter using Token Bucket Algorithm with Redis

- Implemented using the Token Bucket Algorithm.
- Supports both in-memory and Redis-based storage options to meet distributed rate limiting requirements.
- High-performance design: Tokens are generated on-the-fly for the time interval between the last request and the current request, instead of relying on timers.
- Fast communication with Redis using Lua scripts: Lua supports batching multiple requests into a single script execution, reducing communication overhead. Cached Lua scripts can be reused by multiple clients.
- Ensures security: Lua scripts guarantee atomic execution of Redis commands.
- High memory efficiency: Keys are automatically expired and deleted when they are no longer needed, preventing excessive memory consumption.

## Installation

```bash
npm i --save token-bucket-limiter-redis
```

## Import

```js
import { RateLimiterTokenBucket, RateLimiterTokenBucketRedis } from 'token-bucket-limiter-redis';
```

## Usage

Rate limiting can be categorized into stateless rate limiting and stateful rate limiting:

Stateful rate limiter (key-based rate limiter): This type of rate limiter distinguishes requests based on some identifier (e.g., IP address, user ID, URL) and applies rate limiting separately to each identifier. This allows for more fine-grained control over the access frequency of individual users or IPs.

Stateless rate limiter (keyless rate limiter): This type of rate limiter does not distinguish requests by their source and applies uniform rate limiting to all requests. It is simpler to implement but cannot differentiate between requests from different sources.

### In-memory Stateless Rate Limiter

```js
const globalRateLimiter = new RateLimiterTokenBucket({
    tokenPerSecond: 100,
    capacity: 1000,
  });

const globalTokens = globalRateLimiter.getToken();

if (globalTokens > 0) {
  // Proceed with the request
}
```

### In-memory Stateful Rate Limiter

```js
const globalRateLimiter = new RateLimiterTokenBucket({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
  });

const key = ip + uid; // Identify the user with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Proceed with the request
}
```

### Redis-based Stateless Rate Limiter with External Redis Client

Supports distributed rate limiting with an externally provided Redis client (e.g., ioredis).

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
  // Proceed with the request
}
```

### Redis-based Stateful Rate Limiter with External Redis Client

Supports distributed rate limiting with an externally provided Redis client (e.g., ioredis).

```js
import Redis from 'ioredis';

const redis = new Redis({});

const globalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
    redisClient: redis,
  });

const key = ip + uid; // Identify the user with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Proceed with the request
}
```

### Redis-based Stateful Rate Limiter with Built-in Redis

Only provide Redis configuration options (ioredis) for built-in Redis.

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

const key = ip + uid; // Identify the user with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Proceed with the request
}
```

### Adding In-memory Blocking Strategy

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

    // In-memory blocking strategy (only calculates request count on the current server, not distributed)
    inMemoryBlockOnConsumed: 50, // If a key consumes more than 50 tokens in one minute, block requests in memory, preventing Redis calls to mitigate DDoS attacks
    inMemoryBlockDuration: 10, // Blocking duration in seconds
  });

const key = ip + uid; // Identify the user with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Proceed with the request
}
```

The `getToken` method supports a second parameter that specifies the blocking identifier key, typically the IP address or user ID. This is because we want to block a specific user or machine, and if not provided, it defaults to the first parameter, which is the token identifier key.

When using a stateless rate limiter or when the stateful rate limiter's key cannot identify a specific user, you may need to provide this parameter:

```js
const key = 'myproject'; // Stateless rate limiter
const key = 'url'; // Stateful rate limiter, but only limiting a specific route

const blockKey = 'ip'; // The blocking identifier key should be an IP address or user ID

const globalTokens = globalRateLimiter.getToken(key, blockKey);

if (globalTokens > 0) {
  // Proceed with the request
}
```

### Adding Insurance Strategy: Automatically Use In-memory Limiter When Redis Service Fails

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
ASSISTANT -> ALL
    keyPrefix: 'test', // Specify the project or module to which the limiter belongs
    redisOptions: redis,

    // In-memory blocking strategy
    inMemoryBlockOnConsumed: 50, // If a key consumes more than 50 tokens in one minute, block requests in memory, preventing Redis calls to mitigate DDoS attacks
    inMemoryBlockDuration: 10, // Blocking duration in seconds

    // Insurance strategy: Use in-memory limiter automatically when Redis service fails
    insuranceLimiter: true,
    insuranceLimiterTokenPerSecond: 3, // Use the rate limit settings for the in-memory limiter if not specified
    insuranceLimiterCapacity: 3, // Use the capacity settings for the in-memory limiter if not specified
  });

const key = ip + uid; // Identify the user with a key

const globalTokens = globalRateLimiter.getToken(key);

if (globalTokens > 0) {
  // Proceed with the request
}
```

When the insurance strategy is enabled, you can specify the rate and capacity for the in-memory limiter separately. If not specified, it will use the values from the Redis limiter.

In a clustered deployment, such as when using PM2 in cluster mode, these options are useful because each instance is a separate server with its own memory space. Consider the rate limiting speed for each instance when using the in-memory limiter.

## Considerations

1. In-memory limiters are more suitable for single-server rate limiting scenarios. For cluster or distributed deployments, it's recommended to use Redis-based limiters when you can't determine the appropriate rate limiting configuration for each instance.

## FAQ

### What are the advantages of not using timers to generate tokens?

Precision: Timers can be affected by system scheduling and network latency, which may result in inaccurate control of token generation rates.

Resource consumption: If there are a large number of token buckets, maintaining timers for all of them can consume significant system resources.

Time synchronization: Due to precision issues, if there are multiple token buckets in the system, and each has its own timer, these timers may not be synchronized with each other.

Cold start problem: If timers are used to generate tokens, the token bucket may initially be empty when the service starts, which can lead to an inability to handle requests during the initial phase.
