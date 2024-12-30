/**
 *  @description 令牌桶限流器（基于内存）
 */

import { getClientIp } from './utils';

class RateLimiterTokenBucket {
  /**
   * 构造函数
   *
   * @param {object} opts - 选项对象
   * @param {number} opts.tokenPerSecond - 每秒允许的令牌数
   * @param {number} opts.capacity - 容量（最大突发流量）
   * @param {string} opts.keyPrefix - 键名前缀
   * @param {number} opts.lockDuration - 触发限流后的阻塞时间（秒）
   * @param {number} opts.inMemoryBlockOnConsumed - 1分钟消耗令牌数触发阻塞的阈值
   * @param {number} opts.inMemoryBlockDuration - 1分钟消耗令牌数触发阻塞的阻塞时间（秒）
   */
  constructor(opts) {
    this.tokenPerSecond = opts.tokenPerSecond; // 每s允许令牌数
    this.capacity = opts.capacity; // 容量（最大突发流量）
    this.keyPrefix = opts.keyPrefix;
    this.lockDuration = opts.lockDuration || 0; // 触发限流后的阻塞时间s
    this.inMemoryBlockOnConsumed = opts.inMemoryBlockOnConsumed; // 1分钟消耗token数触发阻塞的阈值
    this.inMemoryBlockDuration = opts.inMemoryBlockDuration; // 阻塞时间s

    // 存储令牌桶状态的Map
    this.buckets = new Map();
    // 存储阻塞状态的Map
    this.blockedKeys = new Map();
  }

  /**
   * @param {string} tokenKey - 限流键值，默认ip，如传入则组合在ip后 ip+key
   * @param {string} blockKey - 可选，阻塞键标识，通常是ip或用户id，默认ip
   * @returns {number} - 返回当前可用的令牌数
   */
  getTokenUseIp(req, tokenKey = '', blockKey = '') {
    const ip = getClientIp(req);
    return this.getToken(ip + tokenKey, blockKey || ip);
  }

  /**
   * 计算令牌数量
   * @private
   * @param {string} fullTokenKey - 完整的令牌键
   * @param {number} requestedTokens - 请求的令牌数
   * @returns {[number, number]} - [是否触发限流(1限流 0通过), 当前桶中的令牌数]
   */
  _calculateTokens(fullTokenKey, requestedTokens) {
    // 检查是否已经被限流惩罚
    const lockKey = `${fullTokenKey}-lock`;
    if (this._isKeyBlocked(lockKey)) {
      return [1, 0];
    }

    const now = Date.now();
    let bucket = this.buckets.get(fullTokenKey);

    // 令牌桶不存在，初始化为满桶
    if (!bucket) {
      const bucketAmount = this.capacity;
      bucket = {
        tokens: bucketAmount,
        lastRefillTime: now,
        // 添加定时器，一分钟后自动清除，避免内存泄漏
        timer: setTimeout(() => {
          const bucket = this.buckets.get(fullTokenKey);
          if (bucket) {
            clearTimeout(bucket.timer);  // 清理定时器
            this.buckets.delete(fullTokenKey);
          }
        }, 60000),
      };
      this.buckets.set(fullTokenKey, bucket);
      return [0, bucketAmount];
    }

    // 判断是不是该放入新令牌到桶中了
    const pastTime = now - bucket.lastRefillTime;
    let bucketAmount;

    // 如果上次投放时间到现在的时间小于一个时间单位(1s)，则直接从令牌桶中取走令牌
    if (pastTime < 1000) {
      bucketAmount = bucket.tokens - requestedTokens;
    } else {
      // 如果已过去1s，需要放入一些令牌
      const pastSeconds = Math.floor(pastTime / 1000); // 计算已过去多少s
      const pastInflowQuantity = pastSeconds * this.tokenPerSecond; // 计算应该放入多少令牌
      bucketAmount = bucket.tokens + pastInflowQuantity - requestedTokens; // 计算当前桶中的令牌数

      // 更新最后填充时间
      const lastTime = bucket.lastRefillTime + pastSeconds * 1000;
      bucket.lastRefillTime = lastTime;
    }

    // 确保桶中的令牌数不超过容量，最多填充满桶
    bucketAmount = Math.min(bucketAmount, this.capacity);
    bucket.tokens = bucketAmount;

    // 如果桶中剩余数量小于0，则看看是否需要限流惩罚
    if (bucketAmount <= 0) {
      if (this.lockDuration > 0) {
        // 使用令牌桶限流的阻塞策略
        this._setLockDuration(fullTokenKey);
      }
      return [1, 0]; // 触发限流，返回0
    }

    return [0, bucketAmount];
  }

  /**
   * 获取令牌
   *
   * @param {string} tokenKey - 令牌标识
   * @param {string} blockKey - 可选，阻塞键标识，用于1分钟窗口阻塞，通常是ip或用户id
   * @param {number} requestedTokens - 请求消耗的令牌数，默认值为1
   * @returns {number} - 返回当前可用的令牌数
   */
  // eslint-disable-next-line complexity
  getToken(tokenKey, blockKey = '', requestedTokens = 1) {
    const fullTokenKey = this.keyPrefix + tokenKey;
    const fullBlockedKey = blockKey ? this.keyPrefix + blockKey : fullTokenKey;

    // 如果键被阻塞，则返回0（内存阻塞策略优先）
    if (this._isKeyBlocked(fullBlockedKey)) {
      return 0;
    }

    // 如果设置了inMemoryBlockOnConsumed选项，该策略为固定窗口限流策略
    if (this.inMemoryBlockOnConsumed) {
      // 获取该键在一分钟内消耗的令牌数和最后一次请求的时间戳
      const { consumedTokens, firstRequest } = this.blockedKeys.get(`${fullBlockedKey}:consumed`) || { consumedTokens: 0, firstRequest: 0 };

      // 如果当前时间与最后一次请求的时间差超过一分钟
      if (firstRequest && Date.now() - firstRequest >= 60000) {
        // 清除该键的消耗记录，重置状态
        this.blockedKeys.delete(`${fullBlockedKey}:consumed`);
      } else if (consumedTokens >= this.inMemoryBlockOnConsumed) {
        this.blockedKeys.delete(`${fullBlockedKey}:consumed`);
        // 使用内存限流的阻塞策略
        this._blockKey(fullBlockedKey);
      }
      const currentConsumedTokens = consumedTokens + 1;
      // 增加该键在一分钟内消耗的令牌数
      this.blockedKeys.set(`${fullBlockedKey}:consumed`, { consumedTokens: currentConsumedTokens, firstRequest });
      // 更新首次请求的时间戳
      if (!firstRequest) {
        this.blockedKeys.set(`${fullBlockedKey}:consumed`, { consumedTokens: currentConsumedTokens, firstRequest: Date.now() });
      }
      // 当阻塞键的数量超过999时，收集过期的阻塞键，防止内存泄漏
      if (this.blockedKeys.size > 999) {
        this._collectExpiredBlockedKeys();
      }
    }

    // 计算令牌数
    const [limitTriggered, tokenBalance] = this._calculateTokens(fullTokenKey, requestedTokens);

    console.log(`Request ${limitTriggered ? 'denied' : 'allowed'}. Token balance: ${tokenBalance}`);
    return limitTriggered === 0 ? tokenBalance : 0;
  }

  /**
   * 设置令牌桶限流的阻塞
   * @private
   * @param {string} tokenKey - 令牌桶的key
   */
  _setLockDuration(tokenKey) {
    const lockKey = `${tokenKey}-lock`;
    this.blockedKeys.set(lockKey, Date.now() + this.lockDuration * 1000);
  }

  /**
   * 设置内存限流的阻塞（固定窗口策略）
   * @private
   * @param {string} blockedKey - 阻塞的key
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
      // 阻塞键过期
      if (typeof val === 'number' && val <= now) {
        this.blockedKeys.delete(key);
        // 如果是锁键，只删除自己
        if (!key.endsWith('-lock')) {
          this.blockedKeys.delete(`${key}:consumed`);
        }
      }
      // 计数键过期
      if (key.includes('consumed')) {
        if (now - val.firstRequest >= 60000) {
          this.blockedKeys.delete(key);
        }
      }
    }
  }

  /**
   * 判断指定的键是否被阻塞
   *
   * @private
   * @param {*} key - 指定的键
   * @returns {boolean} - 如果键被阻塞，则返回 true，否则返回 false
   */
  _isKeyBlocked(key) {
    // 检查普通阻塞键
    if (this.blockedKeys.has(key)) {
      const blockUntil = this.blockedKeys.get(key);
      if (Date.now() < blockUntil) {
        return true;
      }
      this.blockedKeys.delete(key);
      this.blockedKeys.delete(`${key}:consumed`);
    }

    // 检查令牌桶限流的锁键
    const lockKey = `${key}-lock`;
    if (this.blockedKeys.has(lockKey)) {
      const lockUntil = this.blockedKeys.get(lockKey);
      if (Date.now() < lockUntil) {
        return true;
      }
      this.blockedKeys.delete(lockKey);
    }

    return false;
  }
}

export default RateLimiterTokenBucket;
