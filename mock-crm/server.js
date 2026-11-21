/**
 * Standalone Mock CRM REST API Server
 * Built with native Node.js HTTP module and persistent SQLite backend.
 */

const http = require('node:http');
const path = require('path');
const CrmDatabase = require('./database');

const PORT = process.env.PORT || 3001;
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
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Idempotency-Key, Authorization'
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON payload: ' + err.message));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Idempotency-Key, Authorization'
    });
    return res.end();
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
    // 1. Health check
    if (pathname === '/api/v1/health' && method === 'GET') {
      return sendJson(res, 200, {
        status: 'UP',
        service: 'mock-crm-service',
        timestamp: new Date().toISOString()
      });
    }

    // 2. Metrics endpoint
    if (pathname === '/api/v1/metrics' && method === 'GET') {
      return sendJson(res, 200, getDb().getMetrics());
    }

    // 3. Create or Deduplicate Lead
    if (pathname === '/api/v1/leads' && method === 'POST') {
      const payload = await parseJsonBody(req);
      const idempotencyKey = req.headers['x-idempotency-key'] || payload.idempotencyKey;

      if (!idempotencyKey) {
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

    // 4. List Leads
    if (pathname === '/api/v1/leads' && method === 'GET') {
      const priority = parsedUrl.searchParams.get('priority');
      const leads = getDb().getAllLeads(priority);
      return sendJson(res, 200, { count: leads.length, leads });
    }

    // 5. Get Single Lead
    if (pathname.startsWith('/api/v1/leads/') && method === 'GET') {
      const leadId = pathname.replace('/api/v1/leads/', '');
      const lead = getDb().getLeadById(leadId);
      if (!lead) return sendJson(res, 404, { error: `Lead not found: ${leadId}` });
      return sendJson(res, 200, { lead });
    }

    // 6. High Priority Alerts
    if (pathname === '/api/v1/alerts' && method === 'POST') {
      const alert = await parseJsonBody(req);
      if (!alert.leadId || !alert.priority || !alert.message) {
        return sendJson(res, 400, { error: 'Missing alert fields (leadId, priority, message)' });
      }
      const result = getDb().insertAlert(alert);
      return sendJson(res, 201, result);
    }

    if (pathname === '/api/v1/alerts' && method === 'GET') {
      const alerts = getDb().getAllAlerts();
      return sendJson(res, 200, { count: alerts.length, alerts });
    }

    // 7. Dead Letter Queue / Quarantine
    if (pathname === '/api/v1/dlq' && method === 'POST') {
      const body = await parseJsonBody(req);
      const result = getDb().insertDeadLetter(body.payload || body, body.errorReason || 'Validation Failure');
      return sendJson(res, 201, result);
    }

    if (pathname === '/api/v1/dlq' && method === 'GET') {
      const items = getDb().getDeadLetters();
      return sendJson(res, 200, { count: items.length, items });
    }

    // 8. SLA Status
    if (pathname === '/api/v1/sla/status' && method === 'GET') {
      const overdue = getDb().getOverdueLeads();
      return sendJson(res, 200, {
        evaluatedAt: new Date().toISOString(),
        overdueCount: overdue.length,
        overdueLeads: overdue
      });
    }

    // 9. Audit Logs
    if (pathname === '/api/v1/audit-logs' && method === 'GET') {
      const leadId = parsedUrl.searchParams.get('leadId');
      const logs = getDb().getAuditLogs(leadId);
      return sendJson(res, 200, { count: logs.length, logs });
    }

    // 10. Chaos Simulator for testing
    if (pathname === '/api/v1/simulate/chaos' && method === 'POST') {
      const body = await parseJsonBody(req);
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
    sendJson(res, 500, { error: 'Internal Server Error', details: err.message });
  }
});

function start(port = PORT, dbPath = null) {
  if (dbPath) {
    process.env.DB_PATH = dbPath;
  }
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
  getDb();
  return new Promise(resolve => {
    server.listen(port, () => {
      console.log(`[Mock CRM] Server listening on port ${port}`);
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
