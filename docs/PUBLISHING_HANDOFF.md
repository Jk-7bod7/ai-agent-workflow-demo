# Public Demo Release & Publishing Handoff

**Project:** Intelligent Lead-to-CRM Automation System  
**Current Visibility:** Private  
**Hardening Branch:** `local-security-hardening`  
**Target Action:** Owner Review & Approval Required Prior to Any External Action  

---

## 1. Owner Decision Checklist

Before publishing this demonstration system publicly, the owner should review and approve the following steps:

1. **Step 1: Review Local Hardening Branch**
   Review code changes on `local-security-hardening` compared to `feature/intelligent-lead-crm-system`:
   ```bash
   git diff feature/intelligent-lead-crm-system..local-security-hardening
   ```

2. **Step 2: Fast-Forward or Merge into Feature Branch**
   ```bash
   git checkout feature/intelligent-lead-crm-system
   git merge --ff-only local-security-hardening
   ```

3. **Step 3: Update GitHub PR #1 (Optional Push)**
   Push hardened commits to GitHub PR #1:
   ```bash
   git push origin feature/intelligent-lead-crm-system
   ```

4. **Step 4: Merge PR #1 into Main (Via GitHub CLI)**
   ```bash
   gh pr merge 1 --squash --delete-branch=false
   ```

5. **Step 5: Change Repository Visibility to Public (Explicit Owner Approval Required)**
   ```bash
   gh repo edit Jk-7bod7/ai-agent-workflow-demo --visibility public
   ```

---

## 2. Screenshot & Visual Evidence Checklist

To support the public launch on LinkedIn and Upwork, capture the following 4 screenshots locally:

1. **Terminal Test Runner (100% Green):**
   Run `node run-all-tests.js` and capture the clean ASCII summary table.
2. **n8n Canvas Workflow Flow:**
   Import `workflow.json` into n8n and capture the 18-node graph showing ingress authentication, validation, CRM upsert, and conditional alerting.
3. **P1 Lead Ingestion & Duplicate Protection:**
   Show curl trigger creating a P1 lead (HTTP 201) followed by duplicate submission returning HTTP 200 with zero second alert.
4. **SQLite Persistence Inspection:**
   Query `crm.sqlite` via sqlite3 CLI showing persisted leads, SHA-256 keys, and audit logs.
