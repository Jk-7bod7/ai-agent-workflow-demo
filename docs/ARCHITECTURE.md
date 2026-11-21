# System Architecture: Intelligent Lead-to-CRM Automation

## 1. System Overview

The **Intelligent Lead-to-CRM Automation System** is an enterprise-grade integration pipeline designed to ingest, validate, deduplicate, score, and route inbound business leads into CRM storage while dispatching real-time notifications for high-priority opportunities and monitoring SLA deadlines.

```mermaid
flowchart TD
    subgraph Inbound["Inbound Channel"]
        WebForm["Web Form / Landing Page"]
        APIClient["External API / Webhook"]
    end

    subgraph n8n["n8n Orchestration Engine"]
        Webhook["Webhook Intake Node<br/>(POST /webhook/leads)"]
        Normalize["Normalize & Fingerprint<br/>(SHA-256 Idempotency)"]
        Validate{"Validate Lead<br/>(RFC 5322 & Bounds)"}
        Score["Score & Categorize Priority<br/>(P1 / P2 / P3 & SLA Calc)"]
        Branch{"Priority == P1?"}
        AlertNode["Dispatch Executive Alert<br/>(HTTP POST /api/v1/alerts)"]
        DLQNode["Quarantine to DLQ<br/>(HTTP POST /api/v1/dlq)"]
        RespondNode["Respond to Webhook<br/>(201 Created / 200 Dup / 422 Rej)"]
    end

    subgraph CRM["Mock CRM & Storage Service (Port 3001)"]
        LeadsTable[("Leads Table<br/>(Persistent SQLite)")]
        AlertsTable[("Alerts Table")]
        DLQTable[("Dead Letter Queue")]
        AuditTable[("Audit Logs")]
    end

    subgraph SLA["Scheduled SLA Monitoring"]
        CronTrigger["Hourly Schedule Trigger"]
        CheckOverdue["Check Overdue Status<br/>(GET /api/v1/sla/status)"]
        Escalate["Dispatch Escalation Alert"]
    end

    WebForm -->|POST Payload| Webhook
    APIClient -->|POST Payload| Webhook
    Webhook --> Normalize
    Normalize --> Validate

    Validate -->|Valid| Score
    Validate -->|Invalid / Spam| DLQNode
    DLQNode --> RespondNode

    Score --> LeadsTable
    LeadsTable --> Branch

    Branch -->|Yes: P1 High Priority| AlertNode
    AlertNode --> AlertsTable
    AlertNode --> RespondNode

    Branch -->|No: P2 / P3 Standard| RespondNode

    CronTrigger --> CheckOverdue
    CheckOverdue --> LeadsTable
    CheckOverdue -->|Breached| Escalate
    Escalate --> AlertsTable
```

---

## 2. Sequence Diagram (End-to-End Execution Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Client as Inbound Client / Form
    participant n8n as n8n Webhook Engine
    participant Engine as Lead Processor Logic
    participant CRM as CRM REST API Service
    participant Storage as SQLite Persistent DB

    Client->>n8n: POST /webhook/leads (Raw Lead Payload)
    n8n->>Engine: Normalize strings & calculate SHA-256 Hash
    Engine-->>n8n: Normalized Lead + Idempotency Key
    n8n->>Engine: Validate Email, Company, Budget, Spam Heuristics

    alt Validation Failed
        Engine-->>n8n: isValid = false (validationErrors)
        n8n->>CRM: POST /api/v1/dlq (Quarantine Payload)
        CRM->>Storage: INSERT INTO dead_letter_queue
        n8n-->>Client: HTTP 422 Unprocessable Entity (Errors Array)
    else Validation Passed
        Engine-->>n8n: isValid = true
        n8n->>Engine: Score Priority (P1/P2/P3), SLA Hours & Target Queue
        Engine-->>n8n: Enriched Lead + SLA Deadline Timestamp
        n8n->>CRM: POST /api/v1/leads (with X-Idempotency-Key)
        CRM->>Storage: Query by idempotency_key

        alt Duplicate Key Exists
            Storage-->>CRM: Existing Record Found
            CRM-->>n8n: HTTP 200 (DUPLICATE, Existing Lead)
            n8n-->>Client: HTTP 200 OK (Duplicate detected, existing reference)
        else New Unique Lead
            CRM->>Storage: INSERT INTO leads + INSERT INTO audit_logs
            CRM-->>n8n: HTTP 201 Created

            alt Priority == 'P1' (Enterprise Tier)
                n8n->>CRM: POST /api/v1/alerts (Executive Slack Alert)
                CRM->>Storage: INSERT INTO alerts
                CRM-->>n8n: HTTP 201 (Alert Dispatched)
                n8n-->>Client: HTTP 201 Created (P1, Alert Dispatched)
            else Priority == 'P2' or 'P3'
                n8n-->>Client: HTTP 201 Created (Standard Routing)
            end
        end
    end
```

---

## 3. Core Architectural Principles

### 1. Deterministic Idempotency
- Every incoming lead is normalized (whitespace trimmed, email lowercased).
- A deterministic SHA-256 hash is computed over `email|company|fullname`.
- The hash is transmitted via HTTP Header `X-Idempotency-Key` to the CRM API.
- If a network retry or client resubmission occurs, the database detects the existing key and returns `HTTP 200 DUPLICATE` without creating redundant records or firing duplicate alerts.

### 2. Strict Qualification & Dynamic SLA Computation
- **P1 (Enterprise)**: Budget ≥ \$50,000 OR Company Size `500+` / `250-500`.
  - SLA: **1 hour**.
  - Routing: `enterprise_exec_sales`.
  - Action: Immediate Slack/SMS alert dispatch to Senior Account Director.
- **P2 (Mid-Market)**: Budget ≥ \$10,000 OR Company Size `50-250`.
  - SLA: **4 hours**.
  - Routing: `midmarket_sales`.
  - Action: Enqueue for dedicated Account Executive.
- **P3 (Standard SMB)**: Budget < \$10,000 and Company Size `1-10`.
  - SLA: **24 hours**.
  - Routing: `marketing_nurture`.
  - Action: Automated email onboarding sequence.
- **SLA Calculation**: `sla_deadline = submittedAt + (slaTargetHours * 3600s)`. Stored in ISO 8601 UTC format.

### 4. Authentication & Security Boundaries
- **Webhook Endpoint**: Requires header `X-Webhook-Secret: lead-webhook-secret-token-2026` to block unauthorized public injections.
- **CRM REST API**: Protected with Bearer token authentication (`Authorization: Bearer test-crm-sec-token-2026`). Missing or invalid tokens immediately yield `HTTP 401 Unauthorized`.
- **Runtime Compatibility**: Mock CRM is pinned to **Node.js 22 LTS (`node:22-alpine`)** to guarantee native `node:sqlite` availability.
- **Task Runner Permissions**: n8n container is configured with `NODE_FUNCTION_ALLOW_BUILTIN=crypto` to permit SHA-256 fingerprinting.
- **Alert Scope**: High-priority alerts are recorded locally in the database `alerts` table (`local_alert_registry`) for notification review. No external Slack webhook integration is claimed.
