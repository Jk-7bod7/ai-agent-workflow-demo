/**
 * Negative Security & Attack-Surface Regression Test Suite
 * Explicitly tests malicious inputs, unauthorized access, oversized bodies,
 * type confusion, and chaos endpoint access control.
 */

const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('node:http');

const { server, start, stop, getDb } = require('../../mock-crm/server');
const { normalizeLead, validateLead } = require('../../lib/lead-processor');

const TEST_PORT = 3099;
const TEST_TOKEN = process.env.CRM_API_KEY || '778bfb33e65827b79a583a27faac06dbba9ac694f1c58135c39d85ea5ab0b171';
const TEST_DB_PATH = path.join(__dirname, 'test-security.sqlite');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          rawBody: data,
          json
        });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runNegativeSecurityTests() {
  console.log('--- Running Negative Security & Adversarial Test Suite ---');

  if (fs.existsSync(TEST_DB_PATH)) {
    try { fs.unlinkSync(TEST_DB_PATH); } catch (_) {}
  }

  process.env.CRM_API_KEY = TEST_TOKEN;
  process.env.ENABLE_TEST_CHAOS = 'false'; // Verify chaos endpoint is blocked by default

  await start(TEST_PORT, TEST_DB_PATH);

  try {
    // 1. Missing Authentication -> 401 Unauthorized
    {
      const res = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'GET'
      });
      assert.strictEqual(res.statusCode, 401, 'Unauthenticated read must return 401');
      assert.match(res.json.error, /Unauthorized/, 'Must return unauthorized error message');
      console.log('✓ 1. Unauthenticated request rejected with HTTP 401');
    }

    // 2. Invalid Token Authentication -> 401 Unauthorized
    {
      const res = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer WRONG_ATTACKER_TOKEN_999'
        }
      });
      assert.strictEqual(res.statusCode, 401, 'Invalid token must return 401');
      console.log('✓ 2. Invalid Bearer token rejected with HTTP 401');
    }

    // 2b. Blank or Empty Bearer Token -> 401 Unauthorized
    {
      const resBlankBearer = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer '
        }
      });
      assert.strictEqual(resBlankBearer.statusCode, 401, 'Blank Bearer token must return 401');

      const resBlankApiKey = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'GET',
        headers: {
          'X-API-Key': ''
        }
      });
      assert.strictEqual(resBlankApiKey.statusCode, 401, 'Blank X-API-Key must return 401');
      console.log('✓ 2b. Blank Bearer token and empty X-API-Key rejected with HTTP 401');
    }

    // 3. Unauthorized Access to Sensitive Audit Logs & DLQ -> 401
    {
      const resAudit = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/audit-logs',
        method: 'GET'
      });
      assert.strictEqual(resAudit.statusCode, 401, 'Audit logs require auth');

      const resDlq = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/dlq',
        method: 'GET'
      });
      assert.strictEqual(resDlq.statusCode, 401, 'DLQ requires auth');
      console.log('✓ 3. Sensitive internal endpoints (audit-logs, dlq) protected with HTTP 401');
    }

    // 4. Chaos Endpoint Blocked in Non-Test Mode -> 403 Forbidden
    {
      const res = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/simulate/chaos',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify({ failNextRequests: 5 }));

      assert.strictEqual(res.statusCode, 403, 'Chaos injection must be forbidden in non-test mode');
      assert.match(res.json.error, /Forbidden/, 'Must return forbidden explanation');
      console.log('✓ 4. Chaos injection endpoint blocked with HTTP 403 when ENABLE_TEST_CHAOS=false');
    }

    // 5. Unsupported Media Type -> 415
    {
      const res = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'text/plain'
        }
      }, 'plain text malicious payload');

      assert.strictEqual(res.statusCode, 415, 'Non-JSON Content-Type must return 415');
      console.log('✓ 5. Unsupported Media Type (text/plain) rejected with HTTP 415');
    }

    // 6. Malformed JSON Body -> 400 Bad Request
    {
      const res = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }, '{ malformed json: true, missing quotes }');

      assert.strictEqual(res.statusCode, 400, 'Malformed JSON must return 400');
      assert.match(res.json.error, /Malformed JSON payload/, 'Must return sanitized parse error');
      console.log('✓ 6. Malformed JSON payload cleanly rejected with HTTP 400');
    }

    // 7. Oversized Body Stream Exceeding 256KB -> 413 Payload Too Large
    {
      const oversizedPayload = JSON.stringify({
        leadId: 'LEAD-OVERSIZED',
        email: 'attacker@overflow.com',
        fullName: 'Buffer Overflow Attempt',
        priority: 'P1',
        bloat: 'X'.repeat(300 * 1024) // 300 KB payload
      });

      const res = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(oversizedPayload)
        }
      }, oversizedPayload);

      assert.strictEqual(res.statusCode, 413, 'Oversized payload must return 413');
      console.log('✓ 7. Oversized request (>256KB) rejected with HTTP 413 Payload Too Large');
    }

    // 8. Type Confusion & Non-String Ingestion (Unit Level)
    {
      const hostileRaw = {
        email: ['injected', 'array', 'exploit@domain.com'],
        fullName: { object: 'malicious' },
        company: 1234567,
        budget: 'not-a-number-attempting-zero-bypass',
        submittedAt: 'totally-invalid-timestamp-string',
        leadId: '../../etc/passwd'
      };

      const normalized = normalizeLead(hostileRaw);
      assert.strictEqual(typeof normalized.email, 'string');
      assert.strictEqual(typeof normalized.fullName, 'string');
      assert.strictEqual(typeof normalized.company, 'string');
      assert.ok(Number.isNaN(normalized.budget), 'Budget must be NaN, not silently coerced to 0');
      assert.strictEqual(normalized.submittedAt, 'INVALID_DATE');
      assert.ok(normalized.leadId.startsWith('LEAD-'), 'Path traversal leadId rejected and auto-generated');

      const validation = validateLead(normalized);
      assert.strictEqual(validation.isValid, false, 'Hostile payload must be invalid');
      assert.ok(validation.errors.some(e => e.includes('email')), 'Must flag invalid email');
      assert.ok(validation.errors.some(e => e.includes('Budget')), 'Must flag invalid budget');
      assert.ok(validation.errors.some(e => e.includes('timestamp')), 'Must flag invalid timestamp');
      console.log('✓ 8. Type confusion attacks (arrays/objects/path traversal) safely sanitized and rejected');
    }

    // 9. SLA Escalation Alert Idempotency
    {
      const dbInstance = getDb();
      // Insert a test lead
      const testLead = {
        idempotencyKey: 'test-sla-idem-key-1',
        leadId: 'LEAD-SLA-TEST-1',
        fullName: 'SLA Test Subject',
        email: 'sla@test.com',
        company: 'SLA Corp',
        companySize: '500+',
        budget: 90000,
        priority: 'P1',
        tier: 'Enterprise Tier',
        slaTargetHours: 1,
        slaDeadline: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      };
      dbInstance.insertLead(testLead);

      // First escalation attempt
      const alertPayload = {
        leadId: testLead.leadId,
        priority: 'SLA_BREACH',
        message: 'First escalation notice'
      };
      const res1 = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/alerts',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify(alertPayload));
      assert.strictEqual(res1.statusCode, 201, 'First alert must succeed with 201');
      assert.strictEqual(res1.json.status, 'LOGGED_LOCALLY');

      // Second identical escalation attempt -> Must NOT insert second alert
      const res2 = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/alerts',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }, JSON.stringify(alertPayload));
      assert.strictEqual(res2.statusCode, 200, 'Duplicate escalation alert returns 200');
      assert.strictEqual(res2.json.status, 'ALREADY_ESCALATED');

      const allAlerts = dbInstance.getAllAlerts().filter(a => a.lead_id === testLead.leadId);
      assert.strictEqual(allAlerts.length, 1, 'Database must contain exactly 1 alert record for this lead');
      console.log('✓ 9. SLA Escalation Alert Idempotency verified (alert storm prevented)');
    }

    // 10. Duplicate Ingestion HTTP Response Code (200 vs 201)
    {
      const leadPayload = {
        idempotencyKey: 'test-dup-key-999',
        leadId: 'LEAD-DUP-999',
        fullName: 'Duplicate User',
        email: 'dup@test.com',
        company: 'Dup Inc',
        priority: 'P1'
      };

      const resCreate = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': leadPayload.idempotencyKey
        }
      }, JSON.stringify(leadPayload));
      assert.strictEqual(resCreate.statusCode, 201, 'First lead returns 201 CREATED');

      const resDup = await makeRequest({
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/api/v1/leads',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TEST_TOKEN}`,
          'Content-Type': 'application/json',
          'X-Idempotency-Key': leadPayload.idempotencyKey
        }
      }, JSON.stringify(leadPayload));
      assert.strictEqual(resDup.statusCode, 200, 'Duplicate submission returns 200 DUPLICATE');
      assert.strictEqual(resDup.json.status, 'DUPLICATE');
      console.log('✓ 10. Ingestion duplicate semantics verified (201 CREATED vs 200 DUPLICATE)');
    }

    console.log('\nAll 10 Negative Security & Attack-Surface Regression Tests PASSED.\n');
  } finally {
    await stop();
    if (fs.existsSync(TEST_DB_PATH)) {
      try { fs.unlinkSync(TEST_DB_PATH); } catch (_) {}
    }
  }
}

if (require.main === module) {
  runNegativeSecurityTests().catch(err => {
    console.error('❌ Negative Security Test Failure:', err);
    process.exit(1);
  });
}

module.exports = { runNegativeSecurityTests };
