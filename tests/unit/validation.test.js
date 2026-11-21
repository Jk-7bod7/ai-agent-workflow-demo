/**
 * Unit Test Suite: Data Validation & Normalization Engine
 */

const assert = require('node:assert');
const { normalizeLead, validateLead } = require('../../lib/lead-processor');

console.log('--- Running Unit Tests: Data Validation & Normalization ---');

// Test 1: Normalization cleans whitespace and generates deterministic hash
const raw1 = {
  fullName: '  Sarah Jenkins  ',
  email: '  SARAH.J@Enterprise.IO  ',
  company: '  Apex Cloud  ',
  budget: '50000'
};
const norm1 = normalizeLead(raw1);
assert.strictEqual(norm1.email, 'sarah.j@enterprise.io', 'Email should be lowercased and trimmed');
assert.strictEqual(norm1.fullName, 'Sarah Jenkins', 'Full name should be trimmed');
assert.strictEqual(norm1.company, 'Apex Cloud', 'Company should be trimmed');
assert.strictEqual(norm1.budget, 50000, 'String budget should be converted to number');
assert.ok(norm1.idempotencyKey.length === 64, 'Idempotency key should be a 64-char SHA-256 hash');
assert.ok(norm1.leadId.startsWith('LEAD-'), 'Lead ID should start with LEAD-');
console.log('✓ Test 1 Passed: Lead normalization and SHA-256 fingerprint generation');

// Test 2: Valid lead passes all checks
const validLead = normalizeLead({
  fullName: 'Alex Rivera',
  email: 'alex@startupcorp.co',
  company: 'Startup Corp',
  budget: 15000
});
const val2 = validateLead(validLead);
assert.strictEqual(val2.isValid, true, 'Valid lead should pass validation');
assert.strictEqual(val2.errors.length, 0, 'Valid lead should have 0 errors');
console.log('✓ Test 2 Passed: Valid lead validation passed');

// Test 3: Invalid email rejected
const badEmailLead = normalizeLead({
  fullName: 'Bad Contact',
  email: 'invalid-email-domain@',
  company: 'Some Org',
  budget: 1000
});
const val3 = validateLead(badEmailLead);
assert.strictEqual(val3.isValid, false, 'Invalid email should fail');
assert.ok(val3.errors.some(e => e.includes('email')), 'Should contain email error');
console.log('✓ Test 3 Passed: Invalid email rejected');

// Test 4: Missing company rejected
const missingCompanyLead = normalizeLead({
  fullName: 'John Doe',
  email: 'john@example.com',
  company: '',
  budget: 1000
});
const val4 = validateLead(missingCompanyLead);
assert.strictEqual(val4.isValid, false, 'Missing company should fail');
assert.ok(val4.errors.some(e => e.includes('Company name is mandatory')));
console.log('✓ Test 4 Passed: Missing company rejected');

// Test 5: Negative budget rejected
const negativeBudgetLead = normalizeLead({
  fullName: 'Scam Lead',
  email: 'scam@example.com',
  company: 'Scam Corp',
  budget: -500
});
const val5 = validateLead(negativeBudgetLead);
assert.strictEqual(val5.isValid, false, 'Negative budget should fail');
assert.ok(val5.errors.some(e => e.includes('Budget must be a non-negative number')));
console.log('✓ Test 5 Passed: Negative budget rejected');

// Test 6: Spam keyword heuristic detection
const spamLead = normalizeLead({
  fullName: 'Crypto Doubler Bot',
  email: 'bot@spam.com',
  company: 'Instant Millions',
  inquiryType: 'Buy followers and crypto-doubler scheme',
  budget: 1000
});
const val6 = validateLead(spamLead);
assert.strictEqual(val6.isValid, false, 'Spam heuristic should trigger failure');
assert.ok(val6.errors.some(e => e.includes('Spam heuristic match')));
console.log('✓ Test 6 Passed: Spam keyword heuristics caught malicious payload');

console.log('All Unit Tests (Validation) Passed Successfully.\n');
