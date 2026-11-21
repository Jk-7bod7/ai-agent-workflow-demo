# Automated Lead Processing Demo (n8n Workflow)

A production-ready demonstration workflow for **n8n** that automates inbound lead ingestion, data validation, tier-based qualification, and structured output formatting.

---

## 🚀 Overview

This workflow is built as an end-to-end automated pipeline designed to evaluate inbound leads without requiring external paid services or sensitive credentials. It uses realistic, synthetic data to showcase how modern AI and automation engineers structure reliable workflows.

### Workflow Pipeline

```text
[Manual Trigger]
       │
       ▼
[Generate Sample Leads] (Synthetic Lead Batch)
       │
       ▼
[Validate Lead Information] (Email regex, mandatory fields, budget integrity)
       │
       ▼
[Filter Valid Leads] (Branching)
       ├── True (Valid) ──> [Categorize Lead Priority] (P1 / P2 / P3 SLA & Routing)
       │
       └── False (Invalid) ─> [Format Disqualified Leads] (Quarantine & Audit Log)
```

---

## 📦 Project Contents

- `workflow.json`: The complete exportable n8n workflow definition.
- `sample-input.json`: Realistic synthetic input lead payload.
- `sample-output.json`: Formatted JSON output showing prioritized and quarantined records.
- `validate-workflow.js`: Automated structural verification & simulation script.

---

## ⚙️ Workflow Architecture & Node Breakdown

| Node Name | Type | Purpose |
|---|---|---|
| **Manual Trigger** | `n8n-nodes-base.manualTrigger` | Initiates the workflow run inside the n8n UI canvas. |
| **Generate Sample Leads** | `n8n-nodes-base.code` | Generates 4 synthetic lead profiles covering enterprise, mid-market, SMB, and invalid/spam records. |
| **Validate Lead Information** | `n8n-nodes-base.code` | Enforces email RFC standards, mandatory corporate fields, and numerical constraints. |
| **Filter Valid Leads** | `n8n-nodes-base.if` | Routes leads based on the boolean `$json.isValid` flag. |
| **Categorize Lead Priority** | `n8n-nodes-base.code` | Assigns priorities (`P1`, `P2`, `P3`), response SLAs (1h, 4h, 24h), and target CRM queues. |
| **Format Disqualified Leads** | `n8n-nodes-base.code` | Captures audit reasons, sets routing to `quarantine_review`, and formats structured records. |

---

## 📥 How to Import & Run in n8n

### Method 1: Import via File
1. Open your **n8n** instance (Cloud or Self-Hosted).
2. Go to the **Workflows** page.
3. Click the **`...`** (three dots) menu in the top right and select **Import from File**.
4. Select `workflow.json` from this repository.
5. Click **Test workflow** to execute the pipeline.

### Method 2: Import via Copy & Paste
1. Open `workflow.json` in any text editor and copy all text (`Ctrl+A`, `Ctrl+C`).
2. In the n8n canvas, click anywhere and press `Ctrl+V` (or `Cmd+V` on Mac).
3. The nodes and connections will appear immediately on your canvas.

---

## 📊 Qualification Logic Matrix

| Priority | Criteria | SLA Target | Target Queue | Action |
|---|---|---|---|---|
| **P1 (Enterprise)** | Budget ≥ \$50,000 OR Company Size `500+` | 1 Hour | `enterprise_exec_sales` | Urgent escalation to Senior Account Director |
| **P2 (Mid-Market)** | Budget ≥ \$10,000 OR Company Size `50-250` | 4 Hours | `midmarket_sales` | Assignment to Dedicated Account Executive |
| **P3 (Standard)** | Budget < \$10,000 & Company Size `1-10` | 24 Hours | `marketing_nurture` | Self-serve product onboarding sequence |
| **Disqualified** | Invalid email, missing name/company, negative budget | N/A | `quarantine_review` | Logged to audit review / flagged as bot spam |

---

## 🧪 Local Testing & Validation

You can validate the JSON syntax, connection graph, and node execution logic without a live n8n instance:

```bash
node validate-workflow.js
```

**Validation Checks Performed:**
- Full JSON syntax and schema compliance.
- Uniqueness of node identifiers and node names.
- Graph resolution: ensures all connection targets exist.
- Data transformation simulation matching n8n JavaScript runtime.

---

## 🛡️ Security & Privacy Notice

- **Zero Credentials Required**: This workflow runs autonomously with zero external API keys or tokens.
- **100% Synthetic Data**: All names, domains, and phone numbers are fictional and generated strictly for testing.
