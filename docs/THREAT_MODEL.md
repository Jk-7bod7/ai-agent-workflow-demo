# Threat Model & Attack Surface Analysis

**Target System:** Intelligent Lead-to-CRM Automation System  
**Methodology:** STRIDE (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege)  
**Security Status:** Reference Architecture Hardened for Local / Staging Demonstration  

---

## 1. System Assets & Critical Data Flows

| Asset ID | Description | Sensitivity | Protection Requirement |
| :--- | :--- | :--- | :--- |
| **A-1** | Webhook Authentication Secret | Confidential | Transmitted via HTTPS / loopback headers only; never in query params. |
| **A-2** | CRM REST API Bearer Token | Confidential | Enforced constant-time comparison; zero plaintext logging. |
| **A-3** | Inbound Lead Records & PII | Confidential / Integrity | Schema-validated, cryptographic SHA-256 idempotency keying. |
| **A-4** | CRM Persistent SQLite Database | Integrity / Availability | Parameterized SQL queries, WAL mode journaling, 127.0.0.1 binding. |
| **A-5** | Dead Letter Queue (DLQ) | Integrity | Protected by Bearer token authentication; bounded payload sizes. |

---

## 2. Trust Boundaries & Entry Points

```
[ External Client / Webhook Caller ]
                │
         (Trust Boundary 1)  <-- Enforces X-Webhook-Secret Header
                ▼
      [ n8n Webhook Node ]
                │
      [ n8n Code Nodes (SHA-256 Fingerprint & Validation) ]
                │
         (Trust Boundary 2)  <-- Enforces CRM Bearer Token Auth & Payload Limits
                ▼
     [ Mock CRM REST API (Node.js 22) ]
                │
         (Trust Boundary 3)  <-- SQLite Parameterized Storage
                ▼
     [ SQLite Database (crm.sqlite) ]
```

---

## 3. STRIDE Threat Analysis & Mitigations

| Threat Category | Potential Attack Scenario | Implemented Mitigation | Residual Risk |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Attacker injects fake leads without credentials. | Fail-closed header validation on ingress. Missing/invalid secret yields HTTP 401 with zero side effects. | Low. Secret key must maintain high entropy. |
| **Tampering** | Attacker sends modified payloads to corrupt CRM records. | Deterministic SHA-256 fingerprinting intercepts duplicates; input validation rejects malformed types. | None. |
| **Repudiation** | Attacker claims duplicate leads were lost. | Audit log records timestamped transitions with unique idempotency keys. | None. |
| **Information Disclosure** | Error responses leak stack traces or database schema details. | Sanitized 500 error responses with opaque error UUIDs; removal of wildcard CORS headers. | None. |
| **Denial of Service** | Attacker streams gigabytes of data to crash the CRM microservice. | Strict streaming byte limiter (256 KB max); requests exceeding limit are destroyed immediately (HTTP 413). | Low. Production deployment should add reverse proxy rate limiting. |
| **Elevation of Privilege** | Attacker uses chaos simulation endpoint to trigger artificial outages. | Chaos injection is strictly gated behind `ENABLE_TEST_CHAOS=true` (HTTP 403 in non-test mode). | None. |

---

## 4. Production Gap & Operational Prerequisites

Before deploying this architecture in commercial production:
1. **TLS Termination:** Ingress must be fronted by Nginx, Caddy, or Cloudflare with TLS certificates.
2. **Secrets Manager:** Replace environment variable files with AWS Secrets Manager, Vault, or GCP Secret Manager.
3. **Database HA:** For high-throughput enterprise deployments, migrate SQLite to managed PostgreSQL.
