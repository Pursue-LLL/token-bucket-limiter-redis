/* eslint-disable no-plusplus */
import { getClientIp } from './utils';
/**
 * 令牌桶限流器（基于内存）
 */
class RateLimiterTokenBucket {
  /**
   * 构造函数
   * @param {number} tokenPerSecond - 每秒产生令牌数
   * @param {number} capacity - 令牌桶总容量
   * @param {string} keyPrefix - 限流器标识
   */
  constructor({ tokenPerSecond, capacity, keyPrefix = '' } = {}) {
    this.tokenPerSecond = tokenPerSecond;
    this.capacity = capacity;
    this.keyPrefix = keyPrefix;
    this.tokens = {}; // 初始令牌数
    this.lastTime = {}; // 上次取令牌时间
    this.cleanupInterval = 3600000; // 清理间隔（毫秒）
    this.expirationThreshold = 86400000; // 过期阈值（毫秒）

    // 设置定时清理
    setInterval(() => {
      const now = Date.now();
      Object.keys(this.tokens).forEach((key) => {
        if (now - this.lastTime[key] > this.expirationThreshold) {
          delete this.tokens[key];
          delete this.lastTime[key];
        }
      });
    }, this.cleanupInterval);
  }

  /**
   * 获取一个令牌，key基于ip
   * @param {Object} req - 请求对象
   * @param {string} key - 限流键值，默认ip，如传入则组合在ip后 ip+key
   * @returns {boolean} 获取是否成功
   */
  getTokenUseIp(req, curKey = '') {
    const ip = getClientIp(req);
    return this.getToken(ip + curKey);
  }

  /**
   * 获取一个令牌
   * @param {string} key - 限流键值，不传默认为 'RateLimiterTokenBucketGlobalKey'，即全局限流
   * @returns {boolean} 获取是否成功
   */
  getToken(curKey = 'RateLimiterTokenBucketGlobalKey') {
    const key = this.keyPrefix + curKey;
    const now = Date.now();

    // 初始化key对应的令牌数和上次取令牌时间
    if (!this.tokens[key]) {
      this.tokens[key] = this.capacity;
      this.lastTime[key] = now;
    }

    // 当前时间和上次时间间隔
    const deltaMS = Math.max(0, now - this.lastTime[key]);
    // 本次间隔内新增令牌数
    const deltaTokens = deltaMS * this.tokenPerSecond / 1000;
    // 更新令牌数（最大不超过容量）
    this.tokens[key] = Math.min(this.tokens[key] + deltaTokens, this.capacity);
    // 更新最后时间
    this.lastTime[key] = now;

    const currentTokens = this.tokens[key];
    if (currentTokens > 0) this.tokens[key]--;
    return currentTokens;
    // if (this.tokens[key] < 1) {
    //   return false;
    // }
    // // 令牌数大于0, 获取成功
    // this.tokens[key]--;
    // return true;
  }
}

export default RateLimiterTokenBucket;
