/**
 * Unit Test Suite: Lead Priority Scoring & SLA Engine
 */

const assert = require('node:assert');
const { normalizeLead, scoreAndCategorize } = require('../../lib/lead-processor');

console.log('--- Running Unit Tests: Priority Scoring & SLA Calculation ---');

// Test 1: Enterprise Lead (P1) - High budget
const entLead = normalizeLead({
  fullName: 'Elena Rostova',
  email: 'elena@hypercloud.com',
  company: 'HyperCloud',
  companySize: '500+',
  budget: 85000,
  submittedAt: '2026-11-21T20:00:00.000Z'
});
const score1 = scoreAndCategorize(entLead);
assert.strictEqual(score1.priority, 'P1', 'High budget/large company must score P1');
assert.strictEqual(score1.tier, 'Enterprise Tier');
assert.strictEqual(score1.slaTargetHours, 1, 'Enterprise SLA must be 1 hour');
assert.strictEqual(score1.routingQueue, 'enterprise_exec_sales');
assert.ok(score1.triggeredRules.includes('RULE_HIGH_BUDGET_OVER_50K'));
assert.ok(score1.triggeredRules.includes('RULE_ENTERPRISE_ORG_SIZE'));
// 1 hour after 20:00 is 21:00
assert.strictEqual(score1.slaDeadline, '2026-11-21T21:00:00.000Z', 'SLA deadline timestamp should be exactly 1 hour ahead');
console.log('✓ Test 1 Passed: Enterprise lead scored P1 with 1-hour SLA');

// Test 2: Mid-Market Lead (P2)
const midLead = normalizeLead({
  fullName: 'Tariq Mansour',
  email: 'tariq@pulseflows.ai',
  company: 'PulseFlows AI',
  companySize: '50-250',
  budget: 22000,
  submittedAt: '2026-11-21T20:00:00.000Z'
});
const score2 = scoreAndCategorize(midLead);
assert.strictEqual(score2.priority, 'P2', 'Mid-market budget must score P2');
assert.strictEqual(score2.slaTargetHours, 4, 'Mid-market SLA must be 4 hours');
assert.strictEqual(score2.routingQueue, 'midmarket_sales');
// 4 hours after 20:00 is 24:00 (next day 00:00)
assert.strictEqual(score2.slaDeadline, '2026-11-22T00:00:00.000Z', 'SLA deadline should be 4 hours ahead');
console.log('✓ Test 2 Passed: Mid-market lead scored P2 with 4-hour SLA');

// Test 3: SMB Lead (P3)
const smbLead = normalizeLead({
  fullName: 'Liam O Connor',
  email: 'liam@craftsupply.ie',
  company: 'Craft Supply Co',
  companySize: '1-10',
  budget: 3500,
  submittedAt: '2026-11-21T20:00:00.000Z'
});
const score3 = scoreAndCategorize(smbLead);
assert.strictEqual(score3.priority, 'P3', 'Low budget small team must score P3');
assert.strictEqual(score3.slaTargetHours, 24, 'SMB SLA must be 24 hours');
assert.strictEqual(score3.routingQueue, 'marketing_nurture');
// 24 hours after 20:00 is 2026-11-22T20:00:00.000Z
assert.strictEqual(score3.slaDeadline, '2026-11-22T20:00:00.000Z', 'SLA deadline should be 24 hours ahead');
console.log('✓ Test 3 Passed: SMB lead scored P3 with 24-hour SLA');

console.log('All Unit Tests (Scoring & SLA) Passed Successfully.\n');
