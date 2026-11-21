# Technical Case Study: Intelligent Lead-to-CRM Automation System

## 1. Project Background & Context

In high-velocity B2B sales and inbound marketing environments, organizations frequently face challenges processing inbound leads efficiently. Common operational failure modes include:
- **Delayed Response Times**: High-value enterprise leads sitting in unmonitored general mailboxes for hours, severely degrading conversion rates.
- **Data Pollution & Duplicates**: Prospective leads submitting multiple forms across marketing campaigns, creating cluttered CRM databases and disjointed sales outreach.
- **Lack of Strict SLA Accountability**: Difficulty tracking whether team response targets are met before prospect interest cools.
- **Spam & Malformed Submissions**: Invalid emails, negative budgets, and automated bot injections consuming SDR bandwidth.

This project was engineered as an **autonomous, production-grade reference architecture** demonstrating how modern workflow automation (n8n), resilient microservices (Node.js REST API), and persistent relational storage (SQLite / PostgreSQL) solve these challenges with zero manual intervention.

---

## 2. Engineering Solution

The system implements a multi-tier, event-driven pipeline:

```text
[Inbound Webhook] 
       ↓
[RFC Validation & Normalization] 
       ↓
[SHA-256 Idempotency Check] 
       ↓
[Dynamic Priority Scoring & SLA Calculation] 
       ↓
[CRM Persistent Ingestion] 
       ↓
[Conditional Executive Alert Dispatch (P1)]
       ↓
[Scheduled SLA Breach Monitoring & Escalation]
```

### Key Technical Innovations:
1. **Cryptographic Deduplication**: SHA-256 fingerprinting on `email|company|fullname` enforces idempotency at the database layer, returning `HTTP 200 DUPLICATE` with existing record references.
2. **Dynamic SLA Deadlines**: Computes precise timestamp deadlines (`submittedAt + SLA_HOURS`) allowing automated background workers to detect and escalate response breaches.
3. **Quarantine & Dead Letter Queue (DLQ)**: Separates unprocessable or spam inputs from valid pipelines without dropping data, facilitating audit analysis.
4. **Transient Failure Recovery**: Implements bounded exponential backoff retries to handle temporary CRM or API downtimes gracefully.

---

## 3. Technology Stack & Implementation Details

| Layer | Technology | Role |
|---|---|---|
| **Workflow Engine** | n8n (`v2.46.6`) | Inbound webhook reception, conditional routing, data enrichment, alert triggers. |
| **Microservice Backend** | Node.js (`v24.22.1` / `v22-alpine`) | REST API for CRM operations, metrics, chaos simulation, and audit logging. |
| **Storage Engine** | Persistent SQLite (`node:sqlite`) | ACID-compliant storage for leads, audit trails, alerts, and dead letter records. Requires Node.js >= 22.5.0. |
| **Containerization** | Docker & Docker Compose (`v5.7.0`) | Multi-container isolated environment for reproducible deployment. |
| **Testing Harness** | Node.js Native Test Framework | Automated unit, integration, chaos/retry, end-to-end, and security scanning. |

---

## 4. Empirical Verification & Test Results

The system was verified against a rigorous 7-part automated test suite with **100% pass rate**:

| Test Suite | Scope | Target Behavior | Result |
|---|---|---|:---:|
| **Workflow Graph Validation** | n8n definitions | Schema integrity, unique node IDs, graph connectivity | **PASS** (60ms) |
| **Data Validation & Normalization** | Unit tests | RFC 5322 regex, trimming, negative budget checks, spam detection | **PASS** (63ms) |
| **Scoring & SLA Engine** | Unit tests | Correct tiering (P1=1h, P2=4h, P3=24h) and deadline math | **PASS** (62ms) |
| **CRM REST API & Idempotency** | Integration tests | Lead CRUD, idempotency enforcement, alert logging, audit trail | **PASS** (179ms) |
| **Chaos & Bounded Retries** | Integration tests | Transient 503 injection, client retry recovery, max retry cap | **PASS** (482ms) |
| **Full Pipeline & Persistence** | E2E tests | 5 test vectors, persistence verification across server restart | **PASS** (328ms) |
| **Security & Secrets Audit** | Security scan | Scan across all repository files for API keys, tokens, and secrets | **PASS** (66ms) |

---

## 5. Scope, Constraints & Honest Limitations

To maintain strict engineering transparency:

### What Is Implemented & Fully Operational:
- Complete n8n workflow definitions (`workflow.json`, `sla-monitor-workflow.json`).
- Fully functional Mock CRM REST API with persistent SQLite database and audit trails.
- End-to-end webhook ingestion, idempotency deduplication, scoring, and dead letter routing.
- Automated testing harness with unit, integration, chaos, and end-to-end coverage.
- Multi-container Docker Compose orchestration.

### What Is Simulated:
- **CRM Integration**: Implemented via a dedicated Mock CRM REST API adhering to standard REST conventions rather than a live paid Salesforce/HubSpot production instance.
- **Alert Dispatch**: Dispatched to internal CRM alert log rather than an active external Slack/PagerDuty webhook.
- **Data**: All lead records, names, companies, and emails are 100% synthetic test fixtures.

### Not Yet Implemented (Future Roadmap):
- OAuth 2.0 token rotation for enterprise SaaS CRMs (HubSpot / Salesforce).
- Multi-region database replication.
- Webhook signature verification (HMAC SHA-256) for incoming payload authentication.
