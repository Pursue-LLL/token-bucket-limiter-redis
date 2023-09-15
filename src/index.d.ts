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
  insuranceLimiterTokenPerSecond?: number;
  insuranceLimiterCapacity?: number;
  inMemoryBlockOnConsumed?: number;
  inMemoryBlockDuration?: number;
}

export class RateLimiterTokenBucketRedis {
  constructor(options: RateLimiterTokenBucketRedisOptions);
  getToken(tokenKey: string, blockKey?: string): Promise<number>;
}
