# token-bucket-limiter-redis

令牌桶算法 + redis 的高效限流器

- 使用令牌桶算法实现
- 支持基于内存和基于 redis 存储的两种选择，满足分布式限流需要
- 高性能，令牌生产的方式为每次请求进来时一次性生产上一次请求到本次请求这一段时间内的令牌，而不是定时器生成令牌
- 快速，使用 `lua` 脚本与redis通讯，lua 支持将多个请求通过脚本的形式一次发送到服务器，减少通讯，并且脚本支持缓存，多客户端可以复用
- 安全，lua 脚本保证redis命令执行的原子性
- 内存效率高，键过期后自动删除，不占用过多内存

## 安装

```bash
npm i --save token-bucket-limiter-redis
```

## 引入

```js
import { RateLimiterTokenBucket, RateLimiterTokenBucketRedis } from 'token-bucket-limiter-redis';
```

## 使用

限流方案我们分为无状态限流器和有状态限流器两种：

有状态的限流器（区分key的限流器）：这种限流器会根据某种标识（如IP地址、用户ID、url等）来进行区分，并对每个标识进行单独的限流。这样可以更精细地控制每个用户或者每个IP的访问频率。

无状态的限流器（不区分key的限流器）：这种限流器不会区分请求的来源，只是简单地对所有请求进行统一的限制。这种方式实现简单，但是无法对不同的请求源进行差异化处理。

### 基于内存的无状态限流器

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

### 基于内存的有状态限流器

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

### 基于redis的无状态限流器，传入redis客户端

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

### 基于redis的有状态限流器，传入redis客户端

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

### 基于redis的有状态限流器，使用内置redis

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

`getToken` 方法支持第二个参数，传入判断阻塞的标识键，通常是ip或用户id，因为我们要阻塞的是某个具体的用户或机器，不传的话默认使用第一个参数，即令牌标识键。

当你使用无状态限流器，或是有状态限流器的键无法标识某个具体用户时可能需要填写该参数：

```js
const key = 'myproject'; // 无状态限流器
const key = 'url'; // 有状态限流器，但是只限制某个路由

const blockKey = 'ip'; // 阻塞标识键须使用ip或用户id

const globalTokens = glopbalRateLimiter.getToken(key, blockKey);

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

    // 保险策略，使用内存限流器
    insuranceLimiter: true,
    insuranceLimiterTokenPerSecond: 3, // 如果未填写将取tokenPerSecond的值
    insuranceLimiterCapacity: 3, // 如果未填写将取capacity的值
  });

const key = ip + uid; // 标识用户信息的key

const globalTokens = glopbalRateLimiter.getToken(key);

if(globalTokens > 0){
  // pass
}

```

开启保险策略后，支持传入保险限制器的每秒令牌数和令牌桶容量，如果不传，将取redis限流器的值。

当你的服务是集群部署时，例如使用 pm2 的集群模式时，会用到这些选项，因为使用redis时令牌是共享的，而集群模式下每个服务是一个实例，每个实例有自己的内存空间，所以你要适当地考虑使用内存限流器时每个实例的限流速率。

## 注意事项

1. 基于内存的限流器更适用于单机限流的场景，集群或分布式部署时，如果你不能计算出每一个实例的合适限流配置的话推荐使用基于redis的限流器。

## FAQ

### 不使用定时器生成令牌有什么好处？

时间精度：定时器的精度可能会受到系统调度和网络延迟的影响，这可能导致令牌的生成速率无法精确控制。

资源消耗：如果令牌桶的数量非常多，那么需要维护的定时器也会非常多，这可能会消耗大量的系统资源。

时间同步：由于精度问题，如果系统中存在多个令牌桶，且每个令牌桶都使用自己的定时器，那么这些定时器之间可能并不同步。

冷启动问题：如果使用定时器生成令牌，那么在服务刚启动时，令牌桶可能会是空的，这可能导致在服务启动初期无法处理请求。