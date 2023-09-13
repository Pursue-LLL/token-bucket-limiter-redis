# token-bucket-limiter-redis

令牌桶算法 + redis 的高效限流器

- 使用令牌桶算法实现
- 支持基于内存和基于 redis 存储的两种选择，满足分布式限流需要
- 高性能，令牌生产的方式为每次请求进来时一次性生产上一次请求到本次请求这一段时间内的令牌，而不是定时器生成令牌

## 安装

```bash
npm i --save token-bucket-limiter-redis
```

## 引入

```js
import { RateLimiterTokenBucket, RateLimiterTokenBucketRedis } from 'token-bucket-limiter-redis';
```

## 使用

### 基于内存的全局限流器

```js
const glopbalRateLimiter = new RateLimiterTokenBucket({
    tokenPerSecond: 100,
    capacity: 1000,
  });

const globalTokens = glopbalRateLimiter.getToken();

if(globalTokens > 0){
  // pass
}

```

### 基于内存的单机限流器

```js
const glopbalRateLimiter = new RateLimiterTokenBucket({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // 指定限流器所属项目或模块
  });

const key = ip + uid; // 标识用户信息的key

const globalTokens = glopbalRateLimiter.getToken(key);

if(globalTokens > 0){
  // pass
}

```

### 基于redis的全局限流器，传入redis客户端

支持分布式限流，外部传入redis客户端 (ioredis)

```js
import Redis from 'ioredis';

const redis = new Redis({});

const glopbalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 100,
    capacity: 1000,
    keyPrefix: 'test', // 指定限流器所属项目或模块
    redisClient: redis,
  });

const key = 'myproject'; // 使用全局唯一key

const globalTokens = glopbalRateLimiter.getToken(key);

if(globalTokens > 0){
  // pass
}

```

### 基于redis的单机限流器，传入redis客户端

支持分布式限流，外部传入redis客户端 (ioredis)

```js
import Redis from 'ioredis';

const redis = new Redis({});

const glopbalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // 指定限流器所属项目或模块
    redisClient: redis,
  });

const key = ip + uid; // 标识用户信息的key

const globalTokens = glopbalRateLimiter.getToken(key);

if(globalTokens > 0){
  // pass
}

```

### 基于redis的单机限流器，使用内置redis

外部仅需传入redis配置（ioredis）

```js
const redisOptions = {
  port: 6379,          // Redis 端口
  host: 'localhost',   // Redis 主机名
  password: 'password' // 如果有的话，你的 Redis 密码
  db: 0,
};

const glopbalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // 指定限流器所属项目或模块
    redisOptions: redis,
  });

const key = ip + uid; // 标识用户信息的key

const globalTokens = glopbalRateLimiter.getToken(key);

if(globalTokens > 0){
  // pass
}

```

### 添加内存阻塞策略

内存阻塞策略可以保护redis服务器，抵御DDoS攻击

```js
const redisOptions = {
  port: 6379,          // Redis 端口
  host: 'localhost',   // Redis 主机名
  password: 'password' // 如果有的话，你的 Redis 密码
  db: 0,
};

const glopbalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // 指定限流器所属项目或模块
    redisOptions: redis,

    // 内存阻塞策略（只计算当前服务器的请求数，非分布式）
    inMemoryBlockOnConsumed: 50, // 如果某个key在一分钟内消耗的令牌数量超过 50，将在内存中阻塞该key的请求，不会发起redis，防止DDoS攻击
    inMemoryBlockDuration: 10, // 阻塞持续时间s
  });

const key = ip + uid; // 标识用户信息的key

const globalTokens = glopbalRateLimiter.getToken(key);

if(globalTokens > 0){
  // pass
}

```

### 添加保险策略，配置当redis服务错误时是否自动使用内存限制器

```js
const redisOptions = {
  port: 6379,          // Redis 端口
  host: 'localhost',   // Redis 主机名
  password: 'password' // 如果有的话，你的 Redis 密码
  db: 0,
};

const glopbalRateLimiter = new RateLimiterTokenBucketRedis({
    tokenPerSecond: 5,
    capacity: 5,
    keyPrefix: 'test', // 指定限流器所属项目或模块
    redisOptions: redis,

    // 内存阻塞策略
    inMemoryBlockOnConsumed: 50, // 如果某个key在一分钟内消耗的令牌数量超过 50，将在内存中阻塞该key的请求，不会发起redis，防止DDoS攻击
    inMemoryBlockDuration: 10, // 阻塞持续时间s

    // 保险策略
    insuranceLimiter: true,
  });

const key = ip + uid; // 标识用户信息的key

const globalTokens = glopbalRateLimiter.getToken(key);

if(globalTokens > 0){
  // pass
}

```

## 注意事项

1. 基于内存的限流器不支持集群模式，集群模式下参数需要做适当调整
