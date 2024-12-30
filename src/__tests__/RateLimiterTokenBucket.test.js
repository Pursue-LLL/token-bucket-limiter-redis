import test from 'ava';
import { RateLimiterTokenBucket } from '../../dist/bundle.js';

test.beforeEach((t) => {
  t.context.limiter = new RateLimiterTokenBucket({
    tokenPerSecond: 2,  // 每秒2个令牌
    capacity: 5,        // 最大容量5个
    keyPrefix: 'test',
    lockDuration: 2,    // 触发限流后阻塞2秒
    inMemoryBlockOnConsumed: 10,  // 1分钟内超过10次触发阻塞
    inMemoryBlockDuration: 3,     // 内存阻塞3秒
  });
});

test('初始化时桶应该是满的', (t) => {
  const tokens = t.context.limiter.getToken('user1');
  t.is(tokens, 5); // 应该返回完整容量
});

test('连续请求应该正确消耗令牌', (t) => {
  const tokens1 = t.context.limiter.getToken('user1');
  const tokens2 = t.context.limiter.getToken('user1');
  const tokens3 = t.context.limiter.getToken('user1');
  t.is(tokens1, 5); // 首次请求返回完整容量
  t.is(tokens2, 4); // 5 - 1 = 4
  t.is(tokens3, 3); // 4 - 1 = 3
});

test('令牌应该随时间自动补充', async (t) => {
  t.context.limiter.getToken('user1'); // 5
  t.context.limiter.getToken('user1'); // 4
  t.context.limiter.getToken('user1'); // 3

  // 等待1秒,应该补充2个令牌
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const tokens = t.context.limiter.getToken('user1');
  t.is(tokens, 4); // 3 + 2 - 1 = 4
});

test('令牌数不应超过容量', async (t) => {
  t.context.limiter.getToken('user1'); // 5

  // 等待3秒,应该补充6个令牌,但不能超过容量5
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const tokens = t.context.limiter.getToken('user1');
  t.is(tokens, 5); // 不应超过容量
});

// TODO: 请求的令牌数大于容量时应该被拒绝;
// test('请求的令牌数大于容量时应该被拒绝', (t) => {
//   const tokens = t.context.limiter.getToken('user1', '', 6);
//   t.is(tokens, 0);
// });

test('请求的令牌数为0时应该返回当前令牌数', (t) => {
  const tokens = t.context.limiter.getToken('user1', '', 0);
  t.is(tokens, 5);
});

// 令牌桶限流惩罚测试
test('令牌不足时应触发限流并阻塞', async (t) => {
  // 快速消耗所有令牌
  t.context.limiter.getToken('user1'); // 5
  t.context.limiter.getToken('user1'); // 4
  t.context.limiter.getToken('user1'); // 3
  t.context.limiter.getToken('user1'); // 2
  t.context.limiter.getToken('user1'); // 1
  const tokens = t.context.limiter.getToken('user1'); // 触发限流
  console.log('🚀 | file: RateLimiterTokenBucket.test.js:72 | test | tokens:', tokens);

  t.is(tokens, 0);

  // 阻塞期间的请求应该被拒绝，触发限流后阻塞2s
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const newTokens = t.context.limiter.getToken('user1');
  t.is(newTokens, 0);
});

test('未设置lockDuration时不应触发令牌桶阻塞', (t) => {
  const noLockLimiter = new RateLimiterTokenBucket({
    tokenPerSecond: 2,
    capacity: 5,
    keyPrefix: 'test',
  });

  // 快速消耗所有令牌
  for (let i = 0; i < 6; i++) {
    const tokens = noLockLimiter.getToken('user1');
    if (i < 5) {
      t.is(tokens, i === 0 ? 5 : 5 - i); // 第一次返回5，之后递减
    } else {
      t.is(tokens, 0);
    }
  }

  // 立即再次请求，应该返回0但不会被阻塞
  const tokens = noLockLimiter.getToken('user1');
  t.is(tokens, 0);
});

// 固定窗口限流测试
test('1分钟内超过阈值应触发阻塞', (t) => {
  const limiter = new RateLimiterTokenBucket({
    tokenPerSecond: 10,
    capacity: 50,
    keyPrefix: 'test',
    inMemoryBlockOnConsumed: 3,  // 1分钟内超过10次触发阻塞
    inMemoryBlockDuration: 3,     // 内存阻塞3秒
  });
  // 快速发起6次请求
  for (let i = 0; i < 6; i++) {
    limiter.getToken('user1', 'ip1');
  }

  // 第6次应该触发阻塞
  const tokens = limiter.getToken('user1', 'ip1');
  t.is(tokens, 0);
});

test('阻塞时间过后应该可以重新请求', async (t) => {
  const limiter = new RateLimiterTokenBucket({
    tokenPerSecond: 10,
    capacity: 50,
    keyPrefix: 'test',
    inMemoryBlockOnConsumed: 3,  // 1分钟内超过10次触发阻塞
    inMemoryBlockDuration: 3,     // 内存阻塞3秒
  });
  // 触发阻塞
  for (let i = 0; i < 6; i++) {
    limiter.getToken('user1', 'ip1');
  }

  // 等待阻塞时间过后
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const tokens = limiter.getToken('user1', 'ip1');
  t.is(tokens, 50);
});

test('拦截全局流量，支持阻塞单个用户，不同的blockKey应该独立计数', (t) => {
  const limiter = new RateLimiterTokenBucket({
    tokenPerSecond: 10,
    capacity: 50,
    keyPrefix: 'test',
    inMemoryBlockOnConsumed: 3,  // 1分钟内超过10次触发阻塞
    inMemoryBlockDuration: 3,     // 内存阻塞3秒
  });
  // ip1 触发阻塞
  for (let i = 0; i < 6; i++) {
    limiter.getToken('globalLimiter', 'ip1');
  }

  // ip2 应该不受影响
  const tokens = limiter.getToken('globalLimiter', 'ip2'); // 50 -3 -1 = 46
  console.log('🚀 | file: RateLimiterTokenBucket.test.js:152 | test | tokens:', tokens);
  t.is(tokens, 46);
});
