/**
 * Pure Lead Processing, Validation, and Categorization Engine
 * Zero external dependencies - standard Node.js crypto and core types.
 */

const crypto = require('node:crypto');

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function normalizeLead(raw = {}) {
  const email = (raw.email || '').trim().toLowerCase();
  const fullName = (raw.fullName || '').trim();
  const company = (raw.company || '').trim();
  const companySize = (raw.companySize || 'Unknown').trim();
  const budget = typeof raw.budget === 'number' ? raw.budget : (parseFloat(raw.budget) || 0);
  const inquiryType = (raw.inquiryType || 'General Inquiry').trim();
  const source = (raw.source || 'Inbound Webhook').trim();
  const submittedAt = raw.submittedAt || new Date().toISOString();

  // Deterministic Idempotency Key: SHA-256 of normalized core attributes
  const hashPayload = `${email}|${company.toLowerCase()}|${fullName.toLowerCase()}`;
  const idempotencyKey = crypto.createHash('sha256').update(hashPayload).digest('hex');

  // Human-readable Lead ID
  const leadId = raw.leadId || `LEAD-${idempotencyKey.substring(0, 8).toUpperCase()}`;

  return {
    leadId,
    idempotencyKey,
    fullName,
    email,
    company,
    companySize,
    budget,
    inquiryType,
    source,
    submittedAt
  };
}

function validateLead(lead) {
  const errors = [];

  if (!lead.email || !EMAIL_REGEX.test(lead.email)) {
    errors.push('Invalid or missing email address');
  }

  if (!lead.fullName || lead.fullName.length < 2) {
    errors.push('Full name is required (minimum 2 characters)');
  }

  if (!lead.company || lead.company.length === 0) {
    errors.push('Company name is mandatory');
  }

  if (typeof lead.budget !== 'number' || isNaN(lead.budget) || lead.budget < 0) {
    errors.push('Budget must be a non-negative number');
  }

  // Spam detection heuristics
  const spamKeywords = ['viagra', 'crypto-doubler', 'buy followers', 'cheap seo bot', 'scraper bot'];
  const content = `${lead.fullName} ${lead.company} ${lead.inquiryType}`.toLowerCase();
  for (const kw of spamKeywords) {
    if (content.includes(kw)) {
      errors.push(`Spam heuristic match detected: "${kw}"`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    validatedAt: new Date().toISOString()
  };
}

function scoreAndCategorize(lead) {
  let priority = 'P3';
  let tier = 'Standard SMB';
  let slaTargetHours = 24;
  let routingQueue = 'marketing_nurture';
  let suggestedAction = 'Enroll in self-serve automated onboarding sequence';
  const rules = [];

  const isEnterpriseSize = lead.companySize === '500+' || lead.companySize === '250-500';
  const isHighBudget = lead.budget >= 50000;
  const isMidmarketSize = lead.companySize === '50-250';
  const isMidBudget = lead.budget >= 10000;

  if (isHighBudget || isEnterpriseSize) {
    priority = 'P1';
    tier = 'Enterprise Tier';
    slaTargetHours = 1;
    routingQueue = 'enterprise_exec_sales';
    suggestedAction = 'URGENT: Direct assignment to Senior Enterprise Account Director';
    if (isHighBudget) rules.push('RULE_HIGH_BUDGET_OVER_50K');
    if (isEnterpriseSize) rules.push('RULE_ENTERPRISE_ORG_SIZE');
  } else if (isMidBudget || isMidmarketSize) {
    priority = 'P2';
    tier = 'Mid-Market Tier';
    slaTargetHours = 4;
    routingQueue = 'midmarket_sales';
    suggestedAction = 'Route to dedicated Commercial Account Executive';
    if (isMidBudget) rules.push('RULE_MID_BUDGET_OVER_10K');
    if (isMidmarketSize) rules.push('RULE_MIDMARKET_ORG_SIZE');
  } else {
    rules.push('RULE_STANDARD_QUALIFICATION');
  }

  // Calculate strict SLA Deadline timestamp
  const submissionTime = new Date(lead.submittedAt).getTime() || Date.now();
  const slaDeadline = new Date(submissionTime + slaTargetHours * 60 * 60 * 1000).toISOString();

  return {
    priority,
    tier,
    slaTargetHours,
    slaDeadline,
    routingQueue,
    suggestedAction,
    triggeredRules: rules
  };
}

module.exports = {
  normalizeLead,
  validateLead,
  scoreAndCategorize
};
