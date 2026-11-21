/**
 * Pure Lead Processing, Validation, and Categorization Engine
 * Zero external dependencies - standard Node.js crypto and core types.
 * Security-hardened for type safety, Unicode normalization, and fail-closed validation.
 */

const crypto = require('node:crypto');

if (!crypto || typeof crypto.createHash !== 'function') {
  throw new Error("FATAL: Node.js 'crypto' module is required for secure SHA-256 idempotency fingerprinting.");
}

// RFC 5321/5322-compliant syntax regex for email format verification
// Maximum total length 254 chars, local part <= 64 chars, valid domain labels
const EMAIL_REGEX = /^(?=.{1,254}$)(?=.{1,64}@)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// Safe string extraction with Unicode NFKC normalization
function sanitizeString(val, fallback = '', maxLength = 255) {
  if (typeof val !== 'string') {
    return fallback;
  }
  // NFKC Unicode normalization prevents visual spoofing and homograph variations
  const normalized = val.normalize('NFKC').trim();
  return normalized.length > maxLength ? normalized.substring(0, maxLength) : normalized;
}

function normalizeLead(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    raw = {};
  }

  const email = sanitizeString(raw.email, '', 254).toLowerCase();
  const fullName = sanitizeString(raw.fullName, '', 100);
  const company = sanitizeString(raw.company, '', 100);
  const companySize = sanitizeString(raw.companySize, 'Unknown', 50);
  
  // Strict numeric handling: do NOT coerce non-numeric strings or NaN to 0
  let budget = raw.budget;
  if (typeof budget === 'string' && budget.trim() !== '') {
    const parsed = Number(budget);
    budget = Number.isFinite(parsed) ? parsed : NaN;
  } else if (typeof budget !== 'number') {
    budget = NaN;
  }

  const inquiryType = sanitizeString(raw.inquiryType, 'General Inquiry', 2000);
  const source = sanitizeString(raw.source, 'Inbound Webhook', 100);

  // Validate or assign submission timestamp
  let submittedAt = raw.submittedAt;
  if (typeof submittedAt === 'string' && submittedAt.trim() !== '') {
    const parsedDate = new Date(submittedAt);
    if (isNaN(parsedDate.getTime())) {
      submittedAt = 'INVALID_DATE';
    } else {
      submittedAt = parsedDate.toISOString();
    }
  } else {
    submittedAt = new Date().toISOString();
  }

  // Deterministic Idempotency Key: SHA-256 of normalized core business identity
  const hashPayload = `${email}|${company.toLowerCase()}|${fullName.toLowerCase()}`;
  const idempotencyKey = crypto.createHash('sha256').update(hashPayload, 'utf8').digest('hex');

  // Human-readable Lead ID (validate user-supplied leadId format or auto-generate)
  let leadId = raw.leadId;
  if (typeof leadId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(leadId.trim())) {
    leadId = leadId.trim();
  } else {
    leadId = `LEAD-${idempotencyKey.substring(0, 8).toUpperCase()}`;
  }

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
    submittedAt,
    _rawBudget: raw.budget,
    _rawSubmittedAt: raw.submittedAt
  };
}

function validateLead(lead) {
  const errors = [];

  if (!lead || typeof lead !== 'object') {
    return {
      isValid: false,
      errors: ['Invalid lead payload: expected JSON object'],
      validatedAt: new Date().toISOString()
    };
  }

  // Email format & length bounds
  if (!lead.email || typeof lead.email !== 'string' || !EMAIL_REGEX.test(lead.email)) {
    errors.push('Invalid or missing email address');
  }

  // Full name bounds
  if (!lead.fullName || typeof lead.fullName !== 'string' || lead.fullName.length < 2) {
    errors.push('Full name is required (minimum 2 characters)');
  } else if (lead.fullName.length > 100) {
    errors.push('Full name exceeds maximum allowed length (100 characters)');
  }

  // Company bounds
  if (!lead.company || typeof lead.company !== 'string' || lead.company.length === 0) {
    errors.push('Company name is mandatory');
  } else if (lead.company.length > 100) {
    errors.push('Company name exceeds maximum allowed length (100 characters)');
  }

  // Strict budget bounds: must be finite, non-negative, <= 1,000,000,000
  if (typeof lead.budget !== 'number' || !Number.isFinite(lead.budget) || isNaN(lead.budget)) {
    errors.push('Budget must be a valid finite number');
  } else if (lead.budget < 0) {
    errors.push('Budget must be a non-negative number');
  } else if (lead.budget > 1000000000) {
    errors.push('Budget exceeds maximum permissible limit ($1,000,000,000)');
  }

  // Timestamp validation
  if (lead.submittedAt === 'INVALID_DATE') {
    errors.push('Invalid submission timestamp format (must be valid ISO-8601 string)');
  }

  // Spam detection heuristics
  const spamKeywords = ['viagra', 'crypto-doubler', 'buy followers', 'cheap seo bot', 'scraper bot'];
  const content = `${lead.fullName || ''} ${lead.company || ''} ${lead.inquiryType || ''}`.toLowerCase();
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
  const isHighBudget = typeof lead.budget === 'number' && lead.budget >= 50000;
  const isMidmarketSize = lead.companySize === '50-250';
  const isMidBudget = typeof lead.budget === 'number' && lead.budget >= 10000;

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

  // Calculate strict SLA Deadline timestamp in UTC
  const parsedTime = lead.submittedAt && lead.submittedAt !== 'INVALID_DATE'
    ? new Date(lead.submittedAt).getTime()
    : NaN;
  const submissionTime = Number.isFinite(parsedTime) ? parsedTime : Date.now();
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
