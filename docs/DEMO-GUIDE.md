# Local Demonstration & Reproduction Guide

This guide provides step-by-step instructions for running, testing, and verifying the **Intelligent Lead-to-CRM Automation System** in any local or containerized environment.

---

## 🛠️ Prerequisites

- **Node.js**: v20+ or v24+ installed locally (uses native `node:sqlite`).
- **Docker & Docker Compose** (Optional, for full containerized deployment).
- **Git**

---

## 🚀 Option 1: Quick Local Run (Zero Docker Overhead)

You can run the full test suite and interactive CRM server directly with Node.js in seconds:

### Step 1: Run Full Automated QA Suite
```bash
# From repository root
node run-all-tests.js
```
*Expected Output:* All 7 test suites pass in ~1.2s with `100% GREEN`.

### Step 2: Start Mock CRM Server
```bash
node mock-crm/server.js
```
The CRM server starts listening on `http://localhost:3001`.

### Step 3: Ingest a Test Lead via cURL / PowerShell

**PowerShell:**
```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/v1/leads" -Method POST -Headers @{
  "Content-Type" = "application/json"
  "Authorization" = "Bearer test-crm-sec-token-2026"
  "X-Idempotency-Key" = "demo-key-1001"
} -Body '{
  "leadId": "LEAD-DEMO-001",
  "fullName": "Elena Rostova",
  "email": "elena.rostova@globalhypercloud.com",
  "company": "Global HyperCloud Inc",
  "companySize": "500+",
  "budget": 85000,
  "priority": "P1",
  "tier": "Enterprise Tier",
  "slaTargetHours": 1,
  "slaDeadline": "2026-11-21T21:00:00.000Z"
}'
```

**cURL:**
```bash
curl -X POST http://localhost:3001/api/v1/leads \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-crm-sec-token-2026" \
  -H "X-Idempotency-Key: demo-key-1001" \
  -d '{
    "leadId": "LEAD-DEMO-001",
    "fullName": "Elena Rostova",
    "email": "elena.rostova@globalhypercloud.com",
    "company": "Global HyperCloud Inc",
    "companySize": "500+",
    "budget": 85000,
    "priority": "P1",
    "tier": "Enterprise Tier",
    "slaTargetHours": 1,
    "slaDeadline": "2026-11-21T21:00:00.000Z"
  }'
```

*Expected Response on 1st run:*
```json
{
  "status": "CREATED",
  "lead": { "id": 1, "lead_id": "LEAD-DEMO-001", ... }
}
```

*Expected Response on 2nd run (Deduplication):*
```json
{
  "status": "DUPLICATE",
  "message": "Lead already processed with this idempotency key",
  "lead": { "id": 1, "lead_id": "LEAD-DEMO-001", ... }
}
```

### Step 4: Inspect Metrics & Audit Logs
```bash
# Check live metrics
curl http://localhost:3001/api/v1/metrics

# Check audit trail
curl http://localhost:3001/api/v1/audit-logs
```

---

## 🐳 Option 2: Docker Compose Full Stack (n8n + Mock CRM)

### Step 1: Start Services
```bash
docker compose up -d
```
This spins up:
- `mock-crm`: Listening on `http://localhost:3001`
- `n8n`: Listening on `http://localhost:5678`

### Step 2: Open n8n Canvas
1. Navigate to `http://localhost:5678` in your browser.
2. Import `workflow.json` via **Workflows ➔ Import from File**.
3. Activate the workflow or click **Test workflow**.

### Step 3: Trigger Webhook
```bash
curl -X POST http://localhost:5678/webhook/leads \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: lead-webhook-secret-token-2026" \
  -d @tests/fixtures/enterprise-lead.json
```

---

## 🧪 Testing Chaos & Failure Recovery

You can simulate transient network failures against the CRM API:

```bash
# Inject 2 transient 503 errors (requires Authorization header)
curl -X POST http://localhost:3001/api/v1/simulate/chaos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-crm-sec-token-2026" \
  -d '{"failNextRequests": 2, "statusCode": 503}'
```
Now send a request with retry logic: The first two attempts receive 503, and the third attempt recovers automatically with 201 Created.
