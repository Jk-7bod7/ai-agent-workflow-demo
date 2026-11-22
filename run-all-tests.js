/**
 * Master Test Runner & Quality Assurance Suite
 * Executes unit, mock integration, adversarial security, e2e, and zero-secrets audits.
 * Strictly separates simulated JavaScript tests from live Docker+n8n tests.
 */

const { spawnSync } = require('node:child_process');
const path = require('path');

const SUITES = [
  { name: '1. Workflow Graph & Schema Validation', script: 'validate-workflow.js', tier: 'Schema / Unit' },
  { name: '2. Unit: Data Validation & Normalization', script: 'tests/unit/validation.test.js', tier: 'Unit' },
  { name: '3. Unit: Priority Scoring & SLA Calculation', script: 'tests/unit/scoring.test.js', tier: 'Unit' },
  { name: '4. Integration: Mock CRM REST API & Idempotency', script: 'tests/integration/crm-api.test.js', tier: 'Mock Integration' },
  { name: '5. Integration: Chaos & Bounded Retry Recovery', script: 'tests/integration/chaos-retry.test.js', tier: 'Mock Integration' },
  { name: '6. Security: Negative & Adversarial Attack Surface', script: 'tests/security/negative-security.test.js', tier: 'Adversarial Security' },
  { name: '7. E2E: Full Pipeline & Persistence Across Restarts', script: 'tests/e2e/e2e-pipeline.test.js', tier: 'Simulated E2E' },
  { name: '8. Security: Zero-Secrets & Credentials Audit', script: 'tests/security/security-scan.test.js', tier: 'Static Security Audit' },
  { name: '9. E2E: Genuine Real Docker + n8n Live HTTP', script: 'tests/e2e/real-n8n-http-e2e.js', tier: 'Real Live E2E (Docker)' }
];

console.log('================================================================');
console.log('  INTELLIGENT LEAD-TO-CRM SYSTEM: AUTOMATED QA TEST RUNNER');
console.log('================================================================\n');

const results = [];
let passCount = 0;
let failCount = 0;
let skippedCount = 0;
const startTime = Date.now();

const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  ENABLE_TEST_CHAOS: 'true',
  CRM_API_KEY: process.env.CRM_API_KEY || '778bfb33e65827b79a583a27faac06dbba9ac694f1c58135c39d85ea5ab0b171',
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || '7eb42b0d5cd9fca178cb26bc21fb25e97defa3867acc4c0fb362d5b8f70d8caf'
};

for (const suite of SUITES) {
  const scriptPath = path.join(__dirname, suite.script);
  process.stdout.write(`Executing [${suite.tier}]: ${suite.name}... `);
  const suiteStart = Date.now();

  const run = spawnSync('node', [scriptPath], {
    cwd: __dirname,
    encoding: 'utf8',
    env: testEnv
  });

  const durationMs = Date.now() - suiteStart;
  const output = (run.stdout || '') + (run.stderr || '');
  const isSkipped = run.status === 2 || output.includes('NOT_RUN') || output.includes('BLOCKED_BY_ENVIRONMENT') || output.includes('Status: SKIPPED');

  let status;
  if (isSkipped) {
    status = 'SKIPPED';
    skippedCount++;
    console.log(`SKIPPED (${durationMs}ms)`);
  } else if (run.status === 0) {
    status = 'PASS';
    passCount++;
    console.log(`PASS (${durationMs}ms)`);
  } else {
    status = 'FAIL';
    failCount++;
    console.log(`FAIL (${durationMs}ms)`);
    console.error('\n--- STDERR / OUTPUT ---');
    console.error(run.stdout);
    console.error(run.stderr);
  }

  results.push({
    Suite: suite.name,
    Tier: suite.tier,
    Status: status,
    Duration: `${durationMs}ms`,
    ExitCode: run.status
  });
}

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n================================================================');
console.log('                     QA TEST EXECUTION SUMMARY                  ');
console.log('================================================================');
console.table(results);
console.log(`Total Suites: ${SUITES.length} | Passed: ${passCount} | Failed: ${failCount} | Skipped: ${skippedCount}`);
console.log(`Total Execution Time: ${totalDuration}s`);

let finalExitCode = 0;
if (failCount > 0) {
  console.log(`Overall Result: TEST SUITE FAILED (${failCount} failure(s))`);
  finalExitCode = 1;
} else if (skippedCount > 0) {
  console.log(`Overall Result: RELEASE CRITERIA NOT MET (${skippedCount} mandatory suite(s) SKIPPED/BLOCKED)`);
  finalExitCode = 1;
} else {
  console.log('Overall Result: ALL MANDATORY SUITES PASSED (100% VERIFIED)');
  finalExitCode = 0;
}
console.log('================================================================\n');

process.exit(finalExitCode);
