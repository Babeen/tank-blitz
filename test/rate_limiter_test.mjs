import assert from 'assert';
import { RateLimiter } from '../server/RateLimiter.js';

console.log('--- allows up to maxEvents within the window ---');
{
  const rl = new RateLimiter(3, 1000);
  assert.strictEqual(rl.allow('a'), true);
  assert.strictEqual(rl.allow('a'), true);
  assert.strictEqual(rl.allow('a'), true);
  assert.strictEqual(rl.allow('a'), false); // 4th call within window -> blocked
}

console.log('--- different keys are tracked independently ---');
{
  const rl = new RateLimiter(1, 1000);
  assert.strictEqual(rl.allow('x'), true);
  assert.strictEqual(rl.allow('y'), true); // separate key, not affected by x's usage
  assert.strictEqual(rl.allow('x'), false);
}

console.log('--- clear() resets a key ---');
{
  const rl = new RateLimiter(1, 1000);
  assert.strictEqual(rl.allow('a'), true);
  assert.strictEqual(rl.allow('a'), false);
  rl.clear('a');
  assert.strictEqual(rl.allow('a'), true);
}

console.log('--- window expiry allows further calls after time passes ---');
{
  const rl = new RateLimiter(1, 50);
  assert.strictEqual(rl.allow('a'), true);
  assert.strictEqual(rl.allow('a'), false);
  await new Promise((r) => setTimeout(r, 70));
  assert.strictEqual(rl.allow('a'), true);
}

console.log('RATE LIMITER TESTS: ALL PASSED');
