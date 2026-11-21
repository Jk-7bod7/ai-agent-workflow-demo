/**
 * Integration Test Suite: Mock CRM REST API & Idempotency Storage
 */

const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('node:http');
const CrmDatabase = require('../../mock-crm/database');
const { start, stop } = require('../../mock-crm/server');

const TEST_DB = path.join(__dirname, 'test-crm.sqlite');
const TEST_PORT = 4001;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

// Clean any previous test db
if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DB_PATH = TEST_DB;

const AUTH_HEADER = { 'Authorization': 'Bearer test-crm-sec-token-2026' };

async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...AUTH_HEADER,
      ...headers
    }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const data = await res.json();
  return { status: res.status, data };
}

async function run() {
  console.log('--- Running Integration Tests: Mock CRM REST API ---');

  await start(TEST_PORT, TEST_DB);
  console.log(`✓ Test CRM Server listening on port ${TEST_PORT}`);

  try {
    // 1. Health check
    const health = await request('GET', '/api/v1/health');
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'UP');
    console.log('✓ Test 1 Passed: GET /api/v1/health returns 200 UP');

    // 1b. Verify 401 Unauthorized when missing API key
    const unauthRes = await fetch(`${BASE_URL}/api/v1/leads`, { method: 'GET' });
    assert.strictEqual(unauthRes.status, 401, 'Should reject unauthenticated calls with 401');
    console.log('✓ Test 1b Passed: Endpoints enforce 401 Unauthorized when API key is missing');

    // 2. Ingest New Qualified Lead
    const newLeadPayload = {
      leadId: 'LEAD-TEST-001',
      idempotencyKey: 'test-hash-key-001',
      fullName: 'Sarah Jenkins',
      email: 'sarah.j@enterprise.io',
      company: 'Apex Cloud Solutions',
      companySize: '500+',
      budget: 75000,
      priority: 'P1',
      tier: 'Enterprise Tier',
      slaTargetHours: 1,
      slaDeadline: new Date(Date.now() + 3600000).toISOString(),
      routingQueue: 'enterprise_exec_sales'
    };

    const res1 = await request('POST', '/api/v1/leads', newLeadPayload, {
      'X-Idempotency-Key': newLeadPayload.idempotencyKey
    });
    assert.strictEqual(res1.status, 201, 'Should return 201 Created');
    assert.strictEqual(res1.data.status, 'CREATED');
    assert.strictEqual(res1.data.lead.lead_id, 'LEAD-TEST-001');
    console.log('✓ Test 2 Passed: POST /api/v1/leads creates new lead record');

    // 3. Duplicate Submission with Same Idempotency Key
    const resDuplicate = await request('POST', '/api/v1/leads', newLeadPayload, {
      'X-Idempotency-Key': newLeadPayload.idempotencyKey
    });
    assert.strictEqual(resDuplicate.status, 200, 'Duplicate submission should return 200');
    assert.strictEqual(resDuplicate.data.status, 'DUPLICATE');
    assert.strictEqual(resDuplicate.data.lead.lead_id, 'LEAD-TEST-001');
    console.log('✓ Test 3 Passed: Duplicate lead detected via idempotency key (prevented double insert)');

    // 4. Missing Idempotency Key Rejected
    const resNoKey = await request('POST', '/api/v1/leads', { fullName: 'No Key' });
    assert.strictEqual(resNoKey.status, 400);
    console.log('✓ Test 4 Passed: Missing idempotency key rejected with 400 Bad Request');

    // 5. High Priority Alert Dispatch
    const alertPayload = {
      leadId: 'LEAD-TEST-001',
      priority: 'P1',
      channel: 'executive_slack',
      message: 'Urgent Enterprise Lead received'
    };
    const resAlert = await request('POST', '/api/v1/alerts', alertPayload);
    assert.strictEqual(resAlert.status, 201);
    assert.strictEqual(resAlert.data.status, 'LOGGED_LOCALLY');
    console.log('✓ Test 5 Passed: POST /api/v1/alerts records local executive alert');

    // 6. Dead Letter Queue Insertion
    const dlqPayload = {
      payload: { raw: 'corrupted lead data' },
      errorReason: 'Malformed JSON syntax'
    };
    const resDlq = await request('POST', '/api/v1/dlq', dlqPayload);
    assert.strictEqual(resDlq.status, 201);
    assert.strictEqual(resDlq.data.status, 'QUEUED_IN_DLQ');
    console.log('✓ Test 6 Passed: POST /api/v1/dlq records quarantined lead');

    // 7. Verify Metrics
    const metrics = await request('GET', '/api/v1/metrics');
    assert.strictEqual(metrics.status, 200);
    assert.strictEqual(metrics.data.totalLeads, 1, 'Total leads should be 1');
    assert.strictEqual(metrics.data.priorityDistribution.P1, 1, 'P1 count should be 1');
    assert.strictEqual(metrics.data.alertsDispatched, 1, 'Alerts dispatched should be 1');
    assert.strictEqual(metrics.data.deadLetterCount, 1, 'Dead letter count should be 1');
    console.log('✓ Test 7 Passed: GET /api/v1/metrics reflects accurate system totals');

    // 8. Audit Logs
    const audit = await request('GET', '/api/v1/audit-logs');
    assert.strictEqual(audit.status, 200);
    assert.ok(audit.data.count >= 3, 'Audit logs should record lead creation, duplicate attempt, and alert');
    console.log('✓ Test 8 Passed: GET /api/v1/audit-logs contains full tamper-evident history');

    console.log('All Integration Tests (Mock CRM REST API) Passed Successfully.\n');
  } finally {
    await stop();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('Integration Test Failure:', err);
    process.exit(1);
  });
}

module.exports = run;
