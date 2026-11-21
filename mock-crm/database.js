/**
 * Persistent SQLite Database Layer for Demo CRM
 * Uses Node.js native DatabaseSync (node:sqlite) - zero third-party dependencies.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

class CrmDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, 'crm.sqlite');
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(this.dbPath);
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotency_key TEXT UNIQUE NOT NULL,
        lead_id TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT NOT NULL,
        company_size TEXT,
        budget REAL,
        inquiry_type TEXT,
        source TEXT,
        priority TEXT NOT NULL,
        tier TEXT NOT NULL,
        sla_target_hours INTEGER,
        sla_deadline TEXT,
        status TEXT DEFAULT 'QUALIFIED',
        routing_queue TEXT,
        suggested_action TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id TEXT,
        event_type TEXT NOT NULL,
        details TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id TEXT NOT NULL,
        priority TEXT NOT NULL,
        channel TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'DISPATCHED',
        dispatched_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS dead_letter_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lead_id TEXT,
        raw_payload TEXT NOT NULL,
        error_reason TEXT NOT NULL,
        retry_count INTEGER DEFAULT 0,
        failed_at TEXT NOT NULL
      );
    `);
  }

  getLeadByIdempotencyKey(key) {
    const stmt = this.db.prepare('SELECT * FROM leads WHERE idempotency_key = ?');
    return stmt.get(key);
  }

  getLeadById(leadId) {
    const stmt = this.db.prepare('SELECT * FROM leads WHERE lead_id = ?');
    return stmt.get(leadId);
  }

  insertLead(lead) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO leads (
        idempotency_key, lead_id, full_name, email, company, company_size,
        budget, inquiry_type, source, priority, tier, sla_target_hours,
        sla_deadline, status, routing_queue, suggested_action, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      lead.idempotencyKey,
      lead.leadId,
      lead.fullName,
      lead.email,
      lead.company,
      lead.companySize || 'Unknown',
      lead.budget || 0,
      lead.inquiryType || 'General',
      lead.source || 'Inbound Webhook',
      lead.priority,
      lead.tier,
      lead.slaTargetHours || 24,
      lead.slaDeadline || null,
      lead.status || 'QUALIFIED',
      lead.routingQueue || 'general_inbox',
      lead.suggestedAction || 'Review lead',
      now,
      now
    );

    this.logAudit(lead.leadId, 'LEAD_CREATED', JSON.stringify({ priority: lead.priority, tier: lead.tier }));
    return this.getLeadById(lead.leadId);
  }

  getAllLeads(filterPriority = null) {
    if (filterPriority) {
      const stmt = this.db.prepare('SELECT * FROM leads WHERE priority = ? ORDER BY id DESC');
      return stmt.all(filterPriority);
    }
    const stmt = this.db.prepare('SELECT * FROM leads ORDER BY id DESC');
    return stmt.all();
  }

  logAudit(leadId, eventType, details) {
    const stmt = this.db.prepare(`
      INSERT INTO audit_logs (lead_id, event_type, details, timestamp)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(leadId || null, eventType, details, new Date().toISOString());
  }

  getAuditLogs(leadId = null) {
    if (leadId) {
      const stmt = this.db.prepare('SELECT * FROM audit_logs WHERE lead_id = ? ORDER BY id DESC');
      return stmt.all(leadId);
    }
    const stmt = this.db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100');
    return stmt.all();
  }

  insertAlert(alert) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO alerts (lead_id, priority, channel, message, status, dispatched_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(alert.leadId, alert.priority, alert.channel || 'executive_slack', alert.message, 'DISPATCHED', now);
    this.logAudit(alert.leadId, 'ALERT_DISPATCHED', JSON.stringify({ channel: alert.channel, priority: alert.priority }));
    return { status: 'DISPATCHED', leadId: alert.leadId, dispatchedAt: now };
  }

  getAllAlerts() {
    const stmt = this.db.prepare('SELECT * FROM alerts ORDER BY id DESC');
    return stmt.all();
  }

  insertDeadLetter(payload, errorReason) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO dead_letter_queue (lead_id, raw_payload, error_reason, failed_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(payload.leadId || null, JSON.stringify(payload), errorReason, now);
    this.logAudit(payload.leadId || null, 'DEAD_LETTER_QUEUED', JSON.stringify({ error: errorReason }));
    return { status: 'QUEUED_IN_DLQ', failedAt: now };
  }

  getDeadLetters() {
    const stmt = this.db.prepare('SELECT * FROM dead_letter_queue ORDER BY id DESC');
    return stmt.all();
  }

  getOverdueLeads() {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      SELECT * FROM leads 
      WHERE sla_deadline IS NOT NULL 
        AND sla_deadline < ? 
        AND status = 'QUALIFIED'
      ORDER BY sla_deadline ASC
    `);
    return stmt.all(now);
  }

  getMetrics() {
    const totalLeads = Number(this.db.prepare('SELECT COUNT(*) as count FROM leads').get().count);
    const p1Count = Number(this.db.prepare("SELECT COUNT(*) as count FROM leads WHERE priority = 'P1'").get().count);
    const p2Count = Number(this.db.prepare("SELECT COUNT(*) as count FROM leads WHERE priority = 'P2'").get().count);
    const p3Count = Number(this.db.prepare("SELECT COUNT(*) as count FROM leads WHERE priority = 'P3'").get().count);
    const alertCount = Number(this.db.prepare('SELECT COUNT(*) as count FROM alerts').get().count);
    const dlqCount = Number(this.db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue').get().count);
    const overdueCount = this.getOverdueLeads().length;

    return {
      totalLeads,
      priorityDistribution: { P1: p1Count, P2: p2Count, P3: p3Count },
      alertsDispatched: alertCount,
      deadLetterCount: dlqCount,
      overdueSlaCount: overdueCount
    };
  }

  close() {
    this.db.close();
  }
}

module.exports = CrmDatabase;
