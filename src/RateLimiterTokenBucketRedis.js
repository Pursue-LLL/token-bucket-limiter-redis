/**
 *  @description 令牌桶限流器（基于redis）
 */
import RateLimiterTokenBucket from './RateLimiterTokenBucket';
import { getClientIp } from './utils';

class RateLimiterTokenBucketRedis {
  /**
   * 构造函数
   *
   * @param {object} opts - 选项对象
   * @param {number} opts.tokenPerSecond - 每秒允许的令牌数
   * @param {number} opts.capacity - 容量（最大突发流量）
   * @param {Redis.RedisOptions} opts.redisOptions - Redis 配置
   * @param {string} opts.keyPrefix - Redis 键名前缀
   * @param {number} opts.lockDuration - 触发限流后的阻塞时间（秒）
   * @param {boolean} opts.insuranceLimiter - 是否启用备用策略
   * @param {number} opts.insuranceLimiterTokenPerSecond - 备用策略每秒允许的令牌数
   * @param {number} opts.insuranceLimiterCapacity - 备用策略容量（最大突发流量）
   * @param {number} opts.inMemoryBlockOnConsumed - 1分钟消耗令牌数触发阻塞的阈值
   * @param {number} opts.inMemoryBlockDuration - 1分钟消耗令牌数触发阻塞的阻塞时间（秒）
   */
  constructor(opts) {
    this.tokenPerSecond = opts.tokenPerSecond; // 每s允许令牌数
    this.capacity = opts.capacity; // 容量（最大突发流量）
    this.redis = opts.redisClient;
    this.keyPrefix = opts.keyPrefix;
    this.insuranceLimiter = opts.insuranceLimiter;
    this.lockDuration = opts.lockDuration || 0; // 触发限流后的阻塞时间s
    this.inMemoryBlockOnConsumed = opts.inMemoryBlockOnConsumed; // 1分钟消耗token数触发阻塞的阈值
    this.inMemoryBlockDuration = opts.inMemoryBlockDuration; // 阻塞时间s
    this.blockedKeys = new Map();

    // 初始化redis
    if (!this.redis) {
      import('ioredis').then((Redis) => {
        this.redis = new Redis(opts.redisOptions);
      }).catch(() => {
        console.warn('ioredis module not found. Please provide a redisClient when creating an instance of RateLimiterTokenBucketRedis.');
      });
    }

    // 启用内存限流器作为备用策略
    if (this.insuranceLimiter) {
      this.rateLimiterTokenBucket = new RateLimiterTokenBucket({
        tokenPerSecond: opts.insuranceLimiterTokenPerSecond || this.tokenPerSecond,
        capacity: opts.insuranceLimiterCapacity || this.capacity,
        keyPrefix: this.keyPrefix,
      });
    }
    this._initScript();
  }

  /**
   * 初始化 Lua 脚本
   * 为了提高系统的性能，减少限流层的资源消耗，令牌的生产方式为：每次请求进来时一次性生产上一次请求到本次请求这一段时间内的令牌。
   * 而不是定时生成令牌：由于线程调度的不确定性，在高并发场景时，定时器误差非常大，同时定时器本身会创建调度线程，也会对系统的性能产生影响。
   * @private
   */
  _initScript() {
    this.script = `
    -- 定义返回值，是个数组，包含：是否触发限流（1限流 0通过）、当前桶中的令牌数
    local ret = {}      -- 创建一个空表，类似 JavaScript 中的 let ret = []
    ret[1] = 0         -- 设置表的第一个元素为0，类似 JavaScript 中的 ret[0] = 0
    -- Redis集群分片Key，KEYS[1]是限流目标
    -- ..是 Lua 的字符串连接运算符
    -- KEYS[1] 是从 Redis 传入的第一个键名
    -- 例如：如果 KEYS[1] = "user:123"，那么 cl_key = "{user:123}"
    local cl_key = '{' .. KEYS[1] .. '}'
    -- 获取限流惩罚的当前设置，触发限流惩罚时会写一个有过期时间的KV
    -- 如果存在限流惩罚，则返回结果[1,-1]
    local lock_key = cl_key .. '-lock'
    local lock_val = redis.call('get', lock_key)
    -- 如果 lock_key 存在且值为 '1'，则表示被限流
    if lock_val == '1' then
        ret[1] = 1    -- 设置限流标志为 1（表示被限流）
        ret[2] = -1   -- 设置令牌数为 -1（表示无可用令牌）
        return ret    -- 立即返回结果，不再继续执行后续逻辑
    end

    -- 获取参数
    local capacity = tonumber(ARGV[1])  -- 桶的容量
    local amount = tonumber(ARGV[2])    -- 本次请求消耗的令牌数
    local inflow_quantity_per_unit = tonumber(ARGV[3])  -- 每个时间单位内流入的令牌数
    local inflow_unit = tonumber(ARGV[4])  -- 时间单位（毫秒）
    local lock_seconds = tonumber(ARGV[5])  -- 触发限流时的惩罚时间（秒）
    local key_expire_time = tonumber(ARGV[6])  -- 令牌桶的过期时间（毫秒）
    local current_time = tonumber(ARGV[7])  -- 当前时间戳（毫秒）

    -- 存储上次令牌放入时间的key
    local st_key = cl_key .. '-st'

    -- 获取[上次向桶中投放令牌的时间]
    local last_time = redis.call('get', st_key)
    if last_time == false then
        -- 令牌桶不存在，初始化为满桶
        local bucket_amount = capacity - amount
        -- 将这个令牌数量更新到令牌桶中
        redis.call('set', KEYS[1], bucket_amount, 'PX', key_expire_time)
        -- 设置[上次向桶中放入令牌的时间]
        redis.call('set', st_key, current_time, 'PX', key_expire_time)
        -- 返回值[当前桶中的令牌数]
        ret[2] = bucket_amount
        return ret
    end

    -- 令牌桶存在，获取令牌桶中的当前令牌数
    local current_value = redis.call('get', KEYS[1])
    current_value = tonumber(current_value)

    -- 判断是不是该放入新令牌到桶中了
    last_time = tonumber(last_time)
    local last_time_changed = 0
    local past_time = current_time - last_time
    local bucket_amount

    -- 如果上次投放时间到现在的时间小于一个时间单位(1s)，则直接从令牌桶中取走令牌
    if past_time < inflow_unit then
        -- 不到投放的时候，直接从令牌桶中取走令牌
        bucket_amount = current_value - amount
    else
        -- 需要放入一些令牌
        local past_inflow_unit_quantity = math.floor(past_time / inflow_unit)
        last_time = last_time + past_inflow_unit_quantity * inflow_unit
        last_time_changed = 1
        local past_inflow_quantity = past_inflow_unit_quantity * inflow_quantity_per_unit
        bucket_amount = current_value + past_inflow_quantity - amount
    end

    -- 确保桶中的令牌数不超过容量
    bucket_amount = math.min(bucket_amount, capacity)

    ret[2] = bucket_amount
    -- 如果桶中剩余数量小于0，则看看是否需要限流惩罚
    if bucket_amount < 0 then
        if lock_seconds > 0 then
            redis.call('set', lock_key, '1', 'EX', lock_seconds, 'NX')
        end
        ret[1] = 1
        return ret
    end

    -- 可以成功扣减令牌，则需要更新令牌桶KV
    if last_time_changed == 1 then
        redis.call('set', KEYS[1], bucket_amount, 'PX', key_expire_time)
        -- 有新投放，更新[上次投放时间]为本次投放时间
        redis.call('set', st_key, last_time, 'PX', key_expire_time)
    else
        redis.call('set', KEYS[1], bucket_amount, 'PX', key_expire_time)
    end

    return ret
    `;
  }

  /**
   * @param {string} tokenKey - 限流键值，默认ip，如传入则组合在ip后 ip+key
   * @param {string} blockKey - 可选，阻塞键标识，通常是ip或用户id，默认ip
   * @returns {Promise<number>} - 返回当前可用的令牌数
   */
  async getTokenUseIp(req, tokenKey = '', blockKey = '') {
    const ip = getClientIp(req);
    return await this.getToken(ip + tokenKey, blockKey || ip);
  }

  /**
   * 获取令牌
   *
   * @param {string} tokenKey - 令牌标识
   * @param {string} blockKey - 可选，阻塞键标识，用于1分钟窗口阻塞，通常是ip或用户id
   * @param {number} requestedTokens - 请求的令牌数，默认值为1
   * @returns {Promise<number>} - 返回当前可用的令牌数
   */
  // eslint-disable-next-line complexity
  async getToken(tokenKey, blockKey, requestedTokens = 1) {
    const fullTokenKey = this.keyPrefix + tokenKey;
    const fullBlockedKey = blockKey ? this.keyPrefix + blockKey : fullTokenKey;

    // 如果键被阻塞，则返回0（内存阻塞策略优先），一旦发现未被阻塞则重置状态
    if (this._isKeyBlocked(fullBlockedKey)) {
      return 0;
    }

    // 如果设置了inMemoryBlockOnConsumed选项（redis崩掉时该功能也生效），该策略为固定窗口限流策略
    if (this.inMemoryBlockOnConsumed) {
      // 获取该键在一分钟内消耗的令牌数和最后一次请求的时间戳
      const { consumedTokens, firstRequest } = this.blockedKeys.get(`${fullBlockedKey}:consumed`) || { consumedTokens: 0, firstRequest: 0 };

      // 如果当前时间与最后一次请求的时间差超过一分钟，超过1分钟则重置状态，假设1分钟内请求没有超，但是已过了该窗口则重新计算
      if (firstRequest && Date.now() - firstRequest >= 60000) {
        // 清除该键的消耗记录，重置状态
        this.blockedKeys.delete(`${fullBlockedKey}:consumed`);
        // 如果该键在一分钟内消耗的令牌数超过了inMemoryBlockOnConsumed选项指定的阈值，在内存中阻塞该键
      } else if (consumedTokens >= this.inMemoryBlockOnConsumed) {
        // 清除该键的消耗记录，阻塞一段时间后重新开始计算一分钟
        this.blockedKeys.delete(`${fullBlockedKey}:consumed`);
        this._blockKey(fullBlockedKey);
      }
      const currentConsumedTokens = consumedTokens + 1;
      // 增加该键在一分钟内消耗的令牌数
      this.blockedKeys.set(`${fullBlockedKey}:consumed`, { consumedTokens: currentConsumedTokens, firstRequest });
      // 更新首次请求的时间戳
      if (!firstRequest) {
        this.blockedKeys.set(`${fullBlockedKey}:consumed`, { consumedTokens: currentConsumedTokens, firstRequest: Date.now() });
      }
      // 当阻塞键的数量超过999时，一次性收集过期的阻塞键而不是每次请求都收集，防止内存泄漏
      if (this.blockedKeys.size > 999) {
        this._collectExpiredBlockedKeys();
      }
    }

    try {
      // 如果Redis连接正常
      if (this._isRedisReady()) {
        // 执行Lua脚本获取当前令牌数
        const [limitTriggered, tokenBalance] = await this.redis.eval(
          this.script,
          1, // 键的数量
          fullTokenKey, // 键
          this.capacity, // 桶的容量
          requestedTokens, // 每次请求消耗的令牌数
          this.tokenPerSecond, // 每个时间单位内流入的令牌数（默认1s）
          1000, // 时间单位（毫秒，默认1s）
          this.lockDuration, // 触发限流时的惩罚时间（秒，默认0）
          60000, // 令牌桶的过期清理时间（毫秒，默认1m）
          Date.now(),
        );
        console.log(`Request ${limitTriggered ? 'denied' : 'allowed'}. Token balance: ${tokenBalance}`);
        return limitTriggered === 0 ? parseFloat(tokenBalance) : 0;
      }
      // 如果Redis连接不正常且启用了备用策略，则使用RateLimiterTokenBucket实例作为备用方案并调用其getToken方法获取当前令牌数
      if (this.insuranceLimiter) {
        return await this.rateLimiterTokenBucket.getToken(fullTokenKey);
      }
      // 如果Redis连接不正常且未启用备用策略，则返回1表示有一个可用的令牌
      return 1;
    } catch (error) {
      // 如果发生错误且启用了备用策略，则使用RateLimiterTokenBucket实例作为备用方案并调用其getToken方法获取当前令牌数
      if (this.insuranceLimiter) {
        return await this.rateLimiterTokenBucket.getToken(fullTokenKey);
      }
      // 如果发生错误且未启用备用策略，则返回1表示有一个可用的令牌
      return 1;
    }
  }

  /**
   * 在内存中阻塞键
   *
   * @param {string} blockedKey
   */
  _blockKey(blockedKey) {
    this.blockedKeys.set(blockedKey, Date.now() + this.inMemoryBlockDuration * 1000);
  }

  /**
   * 清除过期的阻塞键
   */
  _collectExpiredBlockedKeys() {
    const now = Date.now();
    for (const [key, val] of this.blockedKeys.entries()) {
      // 阻塞截止时间小于当前时间，阻塞键过期
      if (typeof val === 'number' && val <= now) {
        this.blockedKeys.delete(key);
      }
      // 计数键对象类型，1分钟过期
      if (key.includes('consumed')) {
        if (now - val.firstRequest >= 60000) {
          this.blockedKeys.delete(key);
        }
      }
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
      console.error('redis 连接状态异常', this.redis.status);
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
    // 阻塞键过期，重置状态
    this.blockedKeys.delete(key);
    this.blockedKeys.delete(`${key}:consumed`);
    return false;
  }
}

export default RateLimiterTokenBucketRedis;
