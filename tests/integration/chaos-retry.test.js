/**
 * Integration Test Suite: Bounded Retries, Chaos Mode & Failure Recovery
 */

const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { start, stop } = require('../../mock-crm/server');

const TEST_DB = path.join(__dirname, 'test-chaos.sqlite');
const TEST_PORT = 4002;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DB_PATH = TEST_DB;

async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const data = await res.json();
  return { status: res.status, data };
}

/**
 * Client-side bounded retry simulator matching n8n's HTTP Request retry behavior
 */
async function sendWithBoundedRetry(payload, maxRetries = 3, backoffMs = 100) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    attempt++;
    const res = await request('POST', '/api/v1/leads', payload, {
      'X-Idempotency-Key': payload.idempotencyKey
    });

    if (res.status >= 200 && res.status < 300) {
      return { success: true, attempts: attempt, result: res };
    }

    if (res.status >= 500 && attempt <= maxRetries) {
      // Exponential backoff
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt - 1)));
      continue;
    }

    return { success: false, attempts: attempt, result: res };
  }
}

async function run() {
  console.log('--- Running Integration Tests: Bounded Retries & Chaos Recovery ---');

  await start(TEST_PORT, TEST_DB);
  console.log(`✓ Chaos Test CRM Server listening on port ${TEST_PORT}`);

  try {
    const testLead = {
      leadId: 'LEAD-CHAOS-001',
      idempotencyKey: 'chaos-test-key-123',
      fullName: 'Dr. Marcus Vance',
      email: 'm.vance@resiliencelab.org',
      company: 'Resilience Labs',
      companySize: '50-250',
      budget: 30000,
      priority: 'P2',
      tier: 'Mid-Market Tier'
    };

    // 1. Inject transient failure (fail next 2 requests with 503)
    console.log('Injecting chaos: Next 2 requests will fail with 503...');
    await request('POST', '/api/v1/simulate/chaos', {
      failNextRequests: 2,
      statusCode: 503,
      message: 'Database connection pool exhausted (Simulated Transient Error)'
    });

    // 2. Execute bounded retry call
    const retryResult = await sendWithBoundedRetry(testLead, 3, 50);
    assert.strictEqual(retryResult.success, true, 'Retry mechanism must successfully recover');
    assert.strictEqual(retryResult.attempts, 3, 'Should succeed on attempt 3 after 2 transient failures');
    assert.strictEqual(retryResult.result.data.status, 'CREATED');
    console.log(`✓ Test 1 Passed: Bounded retry recovered on attempt ${retryResult.attempts} after 2 transient 503s`);

    // 3. Test Permanent Unrecoverable Failure (e.g. 5 failures when maxRetries is 2)
    console.log('Injecting permanent chaos: Next 5 requests will fail with 503...');
    await request('POST', '/api/v1/simulate/chaos', {
      failNextRequests: 5,
      statusCode: 503,
      message: 'Unrecoverable outage'
    });

    const failedResult = await sendWithBoundedRetry({
      ...testLead,
      leadId: 'LEAD-CHAOS-002',
      idempotencyKey: 'chaos-test-key-456'
    }, 2, 50);

    assert.strictEqual(failedResult.success, false, 'Bounded retry must halt when maxRetries exceeded');
    assert.strictEqual(failedResult.attempts, 3, 'Initial attempt + 2 retries = 3 attempts total');
    assert.strictEqual(failedResult.result.status, 503);
    console.log('✓ Test 2 Passed: Bounded retry cleanly halted after reaching max retry limit (prevented infinite loop)');

    // 4. Reset Chaos
    await request('POST', '/api/v1/simulate/chaos', { failNextRequests: 0 });

    console.log('All Chaos & Retry Integration Tests Passed Successfully.\n');
  } finally {
    await stop();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('Chaos Test Failure:', err);
    process.exit(1);
  });
}

module.exports = run;
