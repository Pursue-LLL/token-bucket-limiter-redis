/**
 *  @description 令牌桶限流器（基于redis）
 */
import RateLimiterTokenBucket from './RateLimiterTokenBucket';

class RateLimiterTokenBucketRedis {
  /**
   * 构造函数
   *
   * @param {object} opts - 选项对象
   * @param {number} opts.tokenPerSecond - 每秒允许的令牌数
   * @param {number} opts.capacity - 容量（最大突发流量）
   * @param {RedisClient} opts.redisClient - Redis 客户端
   * @param {string} opts.keyPrefix - Redis 键名前缀
   * @param {boolean} opts.standby - 是否启用备用策略
   * @param {number} opts.inMemoryBlockOnConsumed - 1分钟消耗令牌数触发阻塞的阈值
   * @param {number} opts.inMemoryBlockDuration - 阻塞时间（秒）
   */
  constructor(opts) {
    this.tokenPerSecond = opts.tokenPerSecond; // 每s允许令牌数
    this.capacity = opts.capacity; // 容量（最大突发流量）
    this.redis = opts.redisClient;
    this.keyPrefix = opts.keyPrefix;
    this.standby = opts.standby;
    this.inMemoryBlockOnConsumed = opts.inMemoryBlockOnConsumed; // 1分钟消耗token数触发阻塞的阈值
    this.inMemoryBlockDuration = opts.inMemoryBlockDuration; // 阻塞时间s
    this.blockedKeys = new Map();

    if (!this.redis) {
      import('ioredis').then((Redis) => {
        this.redis = new Redis(opts.redisOptions);
      }).catch(() => {
        console.warn('ioredis module not found. Please provide a redisClient when creating an instance of RateLimiterTokenBucketRedis.');
      });
    }

    // 启用备用策略
    if (this.standby) {
      this.rateLimiterTokenBucket = new RateLimiterTokenBucket({
        tokenPerSecond: this.tokenPerSecond,
        capacity: this.capacity,
        keyPrefix: this.keyPrefix,
      });
    }
    this._initScript();
  }

  /**
   * 初始化 Lua 脚本
   * 为了提高系统的性能，减少限流层的资源消耗，令牌的生产方式为：每次请求进来时一次性生产上一次请求到本次请求这一段时间内的令牌。
   * 而不是定时生成令牌：由于线程调度的不确定性，在高并发场景时，定时器误差非常大，同时定时器本身会创建调度线程，也会对系统的性能产生影响。
   *
   * @private
   */
  _initScript() {
    this.script = `
      -- 获取键名、容量、当前时间
      local key = KEYS[1]
      local capacity = tonumber(ARGV[1])
      local now = tonumber(ARGV[2])

      -- 获取上次请求时间和当前令牌数，如果不存在则分别设置为当前时间和容量
      local lastTime = tonumber(redis.call('HGET', key, 'lastTime')) or now
      local tokens = tonumber(redis.call('HGET', key, 'tokens')) or capacity

      -- 计算时间差和应生成的令牌数
      local deltaMS = math.max(0, now - lastTime)
      local deltaTokens = math.min(deltaMS * ${this.tokenPerSecond} / 1000, capacity - tokens)

      -- 更新令牌数，不能超过容量
      tokens = math.min(tokens + deltaTokens, capacity)

      -- 更新上次请求时间和当前令牌数
      redis.call('HSET', key, 'lastTime', now)
      redis.call('HSET', key, 'tokens', tostring(tokens)) -- 将tokens转换为字符串

      -- 设置键的过期时间为60秒
      redis.call('EXPIRE', key, 60)

      -- 如果令牌数小于1，则返回0，否则减少一个令牌并返回当前令牌数
      if tokens < 1 then
        return 0
      else
        redis.call('HSET', key, 'tokens', tostring(tokens - 1)) -- 实现浮点数自减
        return tokens -- 返回当前令牌数
      end
    `;
  }

  /**
   * 获取令牌
   *
   * @param {string} curKey - 当前键名
   * @returns {Promise<number>} - 返回当前可用的令牌数
   */
  // eslint-disable-next-line complexity
  async getToken(curKey) {
    const key = this.keyPrefix + curKey;

    console.log('🚀 | file: RateLimiterTokenBucketRedis.js:83 | RateLimiterTokenBucketRedis | getToken | this._isKeyBlocked(key):', this._isKeyBlocked(key));

    if (this._isKeyBlocked(key)) {
      return 0;
    }
    try {
      if (this._isRedisReady()) {
        // 如果 Redis 连接正常，执行 Lua 脚本获取当前令牌数
        const currentTokens = await this.redis.eval(this.script, 1, key, this.capacity, Date.now());

        // 如果没有可用的令牌且设置了 inMemoryBlockOnConsumed 选项
        if (currentTokens === 0 && this.inMemoryBlockOnConsumed) {
          // 获取该键在一分钟内消耗的令牌数
          const consumedTokens = this.blockedKeys.get(`${key}:consumed`) || 0;

          // 如果该键在一分钟内消耗的令牌数超过了 inMemoryBlockOnConsumed 选项指定的阈值
          if (consumedTokens && consumedTokens >= this.inMemoryBlockOnConsumed) {
            // 使用 _blockKey 方法在内存中阻塞该键
            this._blockKey(key);
          } else {
            // 增加该键在一分钟内消耗的令牌数并将其过期时间设置为 60 秒
            this.blockedKeys.set(`${key}:consumed`, consumedTokens + 1);
            setTimeout(() => {
              this.blockedKeys.delete(`${key}:consumed`);
            }, 60000);
          }
        }

        // 返回当前令牌数
        return currentTokens;
      } if (this.standby) {
        // 如果 Redis 连接不正常且启用了备用策略，则使用 RateLimiterTokenBucket 实例作为备用方案并调用其 getToken 方法获取当前令牌数
        return await this.rateLimiterTokenBucket.getToken(key);
      }
      // 如果 Redis 连接不正常且未启用备用策略，则返回 1 表示有一个可用的令牌
      return 1;
    } catch (error) {
      if (this.standby) {
        return await this.rateLimiterTokenBucket.getToken(key);
      }
      return 1;
    }
  }

  /**
   * 判断 Redis 连接状态是否正常
   *
   * @private
   * @returns {boolean} - 如果连接状态正常，则返回 true，否则返回 false
   */
  _isRedisReady() {
    // ioredis client
    if (this.redis.status && this.redis.status !== 'ready') {
      return false;
    }
    return true;
  }

  /**
   * 判断指定的键是否被阻塞
   *
   * @private
   * @param {*} key - 指定的键
   * @returns {boolean} - 如果键被阻塞，则返回 true，否则返回 false
   */
  _isKeyBlocked(key) {
    if (!this.blockedKeys.has(key)) {
      return false;
    }
    const blockUntil = this.blockedKeys.get(key);
    if (Date.now() < blockUntil) {
      return true;
    }
    this.blockedKeys.delete(key);
    return false;
  }

  /**
   * 阻塞指定的键
   *
   * @private
   * @param {*} key - 指定的键
   */
  _blockKey(key) {
    // 阻塞截止时间
    const blockUntil = Date.now() + this.inMemoryBlockDuration * 1000;
    this.blockedKeys.set(key, blockUntil);
  }
}

export default RateLimiterTokenBucketRedis;
