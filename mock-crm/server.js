/**
 * Standalone Mock CRM REST API Server
 * Built with native Node.js HTTP module and persistent SQLite backend.
 * 
 * Hardened for streaming payload limits (413), media type validation (415),
 * sanitized error responses, test-mode restricted chaos injection,
 * and least-privilege CORS.
 */

const http = require('node:http');
const path = require('path');
const crypto = require('node:crypto');
const CrmDatabase = require('./database');

const PORT = parseInt(process.env.PORT || '3001', 10);
const CRM_API_KEY = process.env.CRM_API_KEY || 'test-crm-sec-token-2026';
const MAX_BODY_SIZE = 256 * 1024; // 256 KB max payload size
const ENABLE_TEST_CHAOS = process.env.ENABLE_TEST_CHAOS === 'true' || process.env.NODE_ENV === 'test';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';

let db = null;

function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, 'crm.sqlite');
    db = new CrmDatabase(dbPath);
  }
  return db;
}

// Chaos injection state for testing retry/recovery
let chaosState = {
  remainingFailures: 0,
  statusCode: 503,
  message: 'Service Temporarily Unavailable (Simulated)'
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  };

  if (ALLOWED_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN;
    headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Idempotency-Key, Authorization, X-API-Key';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  }

  res.writeHead(statusCode, headers);
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    // 1. Content-Type verification
    const contentType = req.headers['content-type'] || '';
    if (req.method === 'POST' || req.method === 'PUT') {
      if (!contentType.toLowerCase().startsWith('application/json')) {
        const err = new Error('Unsupported Media Type: Content-Type must be application/json');
        err.statusCode = 415;
        return reject(err);
      }
    }

    // 2. Early Content-Length verification
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_BODY_SIZE) {
      const err = new Error(`Payload Too Large: Content-Length ${contentLength} exceeds maximum limit of ${MAX_BODY_SIZE} bytes`);
      err.statusCode = 413;
      return reject(err);
    }

    // 3. Streaming body accumulator with byte-counter limit
    let accumulatedBytes = 0;
    const chunks = [];

    req.on('data', chunk => {
      accumulatedBytes += chunk.length;
      if (accumulatedBytes > MAX_BODY_SIZE) {
        req.destroy();
        const err = new Error(`Payload Too Large: Stream exceeded limit of ${MAX_BODY_SIZE} bytes`);
        err.statusCode = 413;
        return reject(err);
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const rawString = Buffer.concat(chunks).toString('utf8');
      if (!rawString.trim()) return resolve({});

      try {
        const parsed = JSON.parse(rawString);
        resolve(parsed);
      } catch (parseErr) {
        const err = new Error('Malformed JSON payload: Unable to parse request body');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', err => {
      reject(err);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    if (ALLOWED_ORIGIN) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Idempotency-Key, Authorization, X-API-Key'
      });
      return res.end();
    }
    res.writeHead(403);
    return res.end();
  }

  // 1. Health check (public for docker healthchecks & liveness probes)
  if (pathname === '/api/v1/health' && method === 'GET') {
    return sendJson(res, 200, {
      status: 'UP',
      service: 'mock-crm-service',
      timestamp: new Date().toISOString()
    });
  }

  // 2. Enforce API Key Authentication on all other endpoints
  const authHeader = req.headers['authorization'] || '';
  const apiKeyHeader = req.headers['x-api-key'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : apiKeyHeader.trim();

  // Constant-time token comparison to avoid timing side-channels
  let isAuthorized = false;
  if (token && typeof token === 'string' && token.length === CRM_API_KEY.length) {
    try {
      isAuthorized = crypto.timingSafeEqual(Buffer.from(token), Buffer.from(CRM_API_KEY));
    } catch (_) {
      isAuthorized = false;
    }
  }

  if (!isAuthorized) {
    // Never echo back the supplied token or details
    return sendJson(res, 401, {
      error: 'Unauthorized: Missing or invalid API Key. Provide valid Authorization: Bearer <token>'
    });
  }

  // Chaos filter (simulates transient failures for bounded retry verification)
  if (chaosState.remainingFailures > 0 && pathname.startsWith('/api/v1/leads') && method === 'POST') {
    chaosState.remainingFailures--;
    return sendJson(res, chaosState.statusCode, {
      error: chaosState.message,
      remainingFailures: chaosState.remainingFailures
    });
  }

  try {
    // 3. Metrics endpoint
    if (pathname === '/api/v1/metrics' && method === 'GET') {
      return sendJson(res, 200, getDb().getMetrics());
    }

    // 4. Create or Deduplicate Lead
    if (pathname === '/api/v1/leads' && method === 'POST') {
      let payload;
      try {
        payload = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, err.statusCode || 400, { error: err.message });
      }

      const idempotencyKey = req.headers['x-idempotency-key'] || payload.idempotencyKey;

      if (!idempotencyKey || typeof idempotencyKey !== 'string') {
        return sendJson(res, 400, {
          error: 'Missing required header X-Idempotency-Key or body property idempotencyKey'
        });
      }

      if (!payload.leadId || !payload.email || !payload.fullName || !payload.priority) {
        return sendJson(res, 422, {
          error: 'Unprocessable Entity: Missing mandatory lead fields (leadId, email, fullName, priority)'
        });
      }

      // Check duplicate
      const existing = getDb().getLeadByIdempotencyKey(idempotencyKey);
      if (existing) {
        getDb().logAudit(existing.lead_id, 'DUPLICATE_INGESTION_ATTEMPT', JSON.stringify({ key: idempotencyKey }));
        return sendJson(res, 200, {
          status: 'DUPLICATE',
          message: 'Lead already processed with this idempotency key',
          lead: existing
        });
      }

      payload.idempotencyKey = idempotencyKey;
      const created = getDb().insertLead(payload);
      return sendJson(res, 201, {
        status: 'CREATED',
        lead: created
      });
    }

    // 5. List Leads
    if (pathname === '/api/v1/leads' && method === 'GET') {
      const priority = parsedUrl.searchParams.get('priority');
      const leads = getDb().getAllLeads(priority);
      return sendJson(res, 200, { count: leads.length, leads });
    }

    // 6. Get Single Lead
    if (pathname.startsWith('/api/v1/leads/') && method === 'GET') {
      const leadId = pathname.replace('/api/v1/leads/', '');
      const lead = getDb().getLeadById(leadId);
      if (!lead) return sendJson(res, 404, { error: `Lead not found: ${leadId}` });
      return sendJson(res, 200, { lead });
    }

    // 7. High Priority Alerts
    if (pathname === '/api/v1/alerts' && method === 'POST') {
      let alert;
      try {
        alert = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, err.statusCode || 400, { error: err.message });
      }

      if (!alert.leadId || !alert.priority || !alert.message) {
        return sendJson(res, 400, { error: 'Missing alert fields (leadId, priority, message)' });
      }
      const result = getDb().insertAlert(alert);
      const statusCode = result.status === 'ALREADY_ESCALATED' ? 200 : 201;
      return sendJson(res, statusCode, result);
    }

    if (pathname === '/api/v1/alerts' && method === 'GET') {
      const alerts = getDb().getAllAlerts();
      return sendJson(res, 200, { count: alerts.length, alerts });
    }

    // 8. Dead Letter Queue / Quarantine
    if (pathname === '/api/v1/dlq' && method === 'POST') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, err.statusCode || 400, { error: err.message });
      }

      const result = getDb().insertDeadLetter(body.payload || body, body.errorReason || 'Validation Failure');
      return sendJson(res, 201, result);
    }

    if (pathname === '/api/v1/dlq' && method === 'GET') {
      const items = getDb().getDeadLetters();
      return sendJson(res, 200, { count: items.length, items });
    }

    // 9. SLA Status
    if (pathname === '/api/v1/sla/status' && method === 'GET') {
      const overdue = getDb().getOverdueLeads();
      return sendJson(res, 200, {
        evaluatedAt: new Date().toISOString(),
        overdueCount: overdue.length,
        overdueLeads: overdue
      });
    }

    // 10. Audit Logs
    if (pathname === '/api/v1/audit-logs' && method === 'GET') {
      const leadId = parsedUrl.searchParams.get('leadId');
      const logs = getDb().getAuditLogs(leadId);
      return sendJson(res, 200, { count: logs.length, logs });
    }

    // 11. Chaos Simulator for testing (Least privilege: restricted to explicit test mode)
    if (pathname === '/api/v1/simulate/chaos' && method === 'POST') {
      const isChaosPermitted = process.env.ENABLE_TEST_CHAOS === 'true';
      if (!isChaosPermitted) {
        return sendJson(res, 403, {
          error: 'Forbidden: Chaos simulation endpoint is disabled in non-test mode'
        });
      }

      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        return sendJson(res, err.statusCode || 400, { error: err.message });
      }

      chaosState.remainingFailures = body.failNextRequests || 0;
      chaosState.statusCode = body.statusCode || 503;
      chaosState.message = body.message || 'Service Temporarily Unavailable (Simulated)';
      return sendJson(res, 200, {
        status: 'CHAOS_CONFIGURED',
        chaosState
      });
    }

    // 404 Route
    sendJson(res, 404, { error: `Endpoint not found: ${method} ${pathname}` });
  } catch (err) {
    // Sanitized 500 response: never leak internal stack traces or database schema details
    const errorId = crypto.randomUUID();
    console.error(`[Mock CRM Internal Error ${errorId}]`, err);
    sendJson(res, 500, {
      error: 'Internal Server Error',
      errorId
    });
  }
});

const HOST = process.env.HOST || '0.0.0.0';

function start(port = PORT, dbPath = null, host = HOST) {
  if (dbPath) {
    process.env.DB_PATH = dbPath;
  }
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
  getDb();
  return new Promise(resolve => {
    server.listen(port, host, () => {
      console.log(`[Mock CRM] Server listening on ${host}:${port}`);
      resolve(server);
    });
  });
}

function stop() {
  return new Promise(resolve => {
    server.close(() => {
      if (db) {
        try { db.close(); } catch (_) {}
        db = null;
      }
      resolve();
    });
  });
}

if (require.main === module) {
  start();
}

module.exports = { server, start, stop, getDb };
