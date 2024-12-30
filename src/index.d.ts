import type { RedisOptions, RedisClient } from 'ioredis';

export interface RateLimiterTokenBucketOptions {
  tokenPerSecond: number;
  capacity: number;
  keyPrefix: string;
  lockDuration?: number;
  inMemoryBlockOnConsumed?: number;
  inMemoryBlockDuration?: number;
}

export class RateLimiterTokenBucket {
  constructor(options?: RateLimiterTokenBucketOptions);
  getToken(key?: string): number;
  getTokenUseIp(request: object, key?: string): number;
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
  lockDuration?: number;
}

export class RateLimiterTokenBucketRedis {
  constructor(options: RateLimiterTokenBucketRedisOptions);
  getToken(tokenKey: string, blockKey?: string): Promise<number>;
  getTokenUseIp(request: object, tokenKey: string, blockKey?: string): Promise<number>;
}
