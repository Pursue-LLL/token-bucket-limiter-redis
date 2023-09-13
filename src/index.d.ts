import type { RedisOptions, RedisClient } from 'ioredis';

export interface RateLimiterTokenBucketOptions {
  tokenPerSecond: number;
  capacity: number;
  keyPrefix: string;
}

export class RateLimiterTokenBucket {
  constructor(options?: RateLimiterTokenBucketOptions);
  getToken(key?: string): boolean;
}

export interface RateLimiterTokenBucketRedisOptions {
  tokenPerSecond: number;
  capacity: number;
  redisClient?: RedisClient;
  redisOptions?: RedisOptions;
  keyPrefix: string;
  insuranceLimiter?: boolean;
  inMemoryBlockOnConsumed?: number;
  inMemoryBlockDuration?: number;
}

export class RateLimiterTokenBucketRedis {
  constructor(options: RateLimiterTokenBucketRedisOptions);
  getToken(key: string): Promise<number>;
}
