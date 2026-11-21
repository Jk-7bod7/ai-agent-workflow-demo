/**
 * End-to-End Pipeline & Persistence Test Suite
 */

const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { normalizeLead, validateLead, scoreAndCategorize } = require('../../lib/lead-processor');
const { start, stop } = require('../../mock-crm/server');

const TEST_DB = path.join(__dirname, 'e2e-crm.sqlite');
const TEST_PORT = 4003;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
process.env.DB_PATH = TEST_DB;

// Load test fixtures
const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const enterpriseLeadRaw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'enterprise-lead.json'), 'utf8'));
const midmarketLeadRaw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'midmarket-lead.json'), 'utf8'));
const smbLeadRaw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'smb-lead.json'), 'utf8'));
const invalidLeadRaw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'invalid-lead.json'), 'utf8'));
const duplicateLeadRaw = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'duplicate-lead.json'), 'utf8'));

async function request(method, path, body = null, headers = {}) {
  const url = `${BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Connection': 'close',
      ...headers
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(url, options);
  const data = await res.json();
  return { status: res.status, data };
}

/**
 * Executes full pipeline logic matching the n8n orchestration graph
 */
async function processPipeline(rawPayload) {
  // Step 1: Normalize & Fingerprint
  const normalized = normalizeLead(rawPayload);

  // Step 2: Validate
  const validation = validateLead(normalized);
  if (!validation.isValid) {
    // Quarantine to DLQ
    const dlqRes = await request('POST', '/api/v1/dlq', {
      payload: normalized,
      errorReason: 'Validation Failure: ' + validation.errors.join('; ')
    });
    return {
      status: 'REJECTED',
      statusCode: 422,
      errors: validation.errors,
      dlq: dlqRes.data
    };
  }

  // Step 3: Score & Categorize
  const scoring = scoreAndCategorize(normalized);
  const enrichedLead = {
    ...normalized,
    ...scoring
  };

  // Step 4: Upsert into CRM with Idempotency Key
  const crmRes = await request('POST', '/api/v1/leads', enrichedLead, {
    'X-Idempotency-Key': enrichedLead.idempotencyKey
  });

  // Step 5: Check duplicate
  if (crmRes.data.status === 'DUPLICATE') {
    return {
      status: 'DUPLICATE',
      statusCode: 200,
      lead: crmRes.data.lead,
      message: crmRes.data.message
    };
  }

  // Step 6: Dispatch Alert if P1
  let alertResult = null;
  if (enrichedLead.priority === 'P1') {
    const alertRes = await request('POST', '/api/v1/alerts', {
      leadId: enrichedLead.leadId,
      priority: 'P1',
      channel: 'executive_slack',
      message: `🚨 URGENT P1: ${enrichedLead.fullName} from ${enrichedLead.company} (Budget: $${enrichedLead.budget})`
    });
    alertResult = alertRes.data;
  }

  return {
    status: 'SUCCESS',
    statusCode: 201,
    priority: enrichedLead.priority,
    lead: crmRes.data.lead,
    alert: alertResult
  };
}

async function run() {
  console.log('--- Running End-to-End Pipeline & Persistence Tests ---');

  await start(TEST_PORT, TEST_DB);
  console.log(`✓ E2E CRM Server listening on port ${TEST_PORT}`);

  try {
    // 1. Process Enterprise Lead -> P1 + Alert
    console.log('[E2E Step 1] Ingesting Enterprise Lead...');
    const res1 = await processPipeline(enterpriseLeadRaw);
    assert.strictEqual(res1.statusCode, 201);
    assert.strictEqual(res1.priority, 'P1');
    assert.ok(res1.alert !== null, 'P1 lead must trigger high-priority alert');
    assert.strictEqual(res1.alert.status, 'DISPATCHED');
    console.log('✓ Enterprise Lead processed: Scored P1, CRM created, Alert dispatched.');

    // 2. Process Mid-Market Lead -> P2 (No alert)
    console.log('[E2E Step 2] Ingesting Mid-Market Lead...');
    const res2 = await processPipeline(midmarketLeadRaw);
    assert.strictEqual(res2.statusCode, 201);
    assert.strictEqual(res2.priority, 'P2');
    assert.strictEqual(res2.alert, null, 'P2 lead should not dispatch P1 alert');
    console.log('✓ Mid-Market Lead processed: Scored P2, CRM created, Routed to AE queue.');

    // 3. Process SMB Lead -> P3 (No alert)
    console.log('[E2E Step 3] Ingesting SMB Lead...');
    const res3 = await processPipeline(smbLeadRaw);
    assert.strictEqual(res3.statusCode, 201);
    assert.strictEqual(res3.priority, 'P3');
    assert.strictEqual(res3.alert, null);
    console.log('✓ SMB Lead processed: Scored P3, CRM created, Routed to Nurture queue.');

    // 4. Duplicate Submission Test
    console.log('[E2E Step 4] Ingesting Duplicate Enterprise Lead...');
    const resDup = await processPipeline(duplicateLeadRaw);
    assert.strictEqual(resDup.statusCode, 200);
    assert.strictEqual(resDup.status, 'DUPLICATE');
    assert.strictEqual(resDup.lead.lead_id, res1.lead.lead_id, 'Duplicate must return existing lead reference');
    console.log('✓ Duplicate Lead detected: Prevented double ingestion, returned existing record.');

    // 5. Invalid Input Test
    console.log('[E2E Step 5] Ingesting Invalid / Spam Lead...');
    const resInv = await processPipeline(invalidLeadRaw);
    assert.strictEqual(resInv.statusCode, 422);
    assert.strictEqual(resInv.status, 'REJECTED');
    assert.ok(resInv.errors.length >= 3, 'Must report all validation errors');
    assert.strictEqual(resInv.dlq.status, 'QUEUED_IN_DLQ');
    console.log('✓ Invalid Lead quarantined to Dead Letter Queue with 422 Unprocessable Entity.');

    // 6. Verify System Metrics before restart
    const metricsBefore = await request('GET', '/api/v1/metrics');
    assert.strictEqual(metricsBefore.data.totalLeads, 3, 'Total qualified leads should be exactly 3');
    assert.strictEqual(metricsBefore.data.alertsDispatched, 1, 'Total alerts dispatched should be 1');
    assert.strictEqual(metricsBefore.data.deadLetterCount, 1, 'Total dead letters should be 1');
    console.log('✓ Pre-restart Metrics Verified: 3 qualified, 1 alert, 1 dead letter.');

    // 7. Restart and Persistence Test
    console.log('[E2E Step 6] Testing Service Restart & Persistence...');
    console.log('Stopping CRM server...');
    await stop();
    console.log('Restarting CRM server on same database file...');
    await start(TEST_PORT, TEST_DB);
    await new Promise(r => setTimeout(r, 100));
    console.log('CRM server restarted.');

    const metricsAfter = await request('GET', '/api/v1/metrics');
    assert.deepStrictEqual(metricsBefore.data, metricsAfter.data, 'Metrics must match exactly after service restart');

    const leadsAfter = await request('GET', '/api/v1/leads');
    assert.strictEqual(leadsAfter.data.count, 3, 'All 3 leads must persist across restarts');
    console.log('✓ Persistence Test Passed: 100% of leads, alerts, and metrics persisted intact across restart!');

    console.log('All End-to-End Pipeline & Persistence Tests Passed Successfully.\n');
  } finally {
    await stop();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error('E2E Test Failure:', err);
    process.exit(1);
  });
}

module.exports = run;
