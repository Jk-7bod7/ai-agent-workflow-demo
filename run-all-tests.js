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
let overallPass = true;
const startTime = Date.now();

for (const suite of SUITES) {
  const scriptPath = path.join(__dirname, suite.script);
  process.stdout.write(`Executing [${suite.tier}]: ${suite.name}... `);
  const suiteStart = Date.now();

  const run = spawnSync('node', [scriptPath], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', ENABLE_TEST_CHAOS: 'true' }
  });

  const durationMs = Date.now() - suiteStart;
  const passed = run.status === 0;

  // Check if test was cleanly skipped / not run due to environment prerequisites
  const output = (run.stdout || '') + (run.stderr || '');
  const isSkipped = output.includes('NOT_RUN') || output.includes('BLOCKED_BY_ENVIRONMENT');
  const status = passed ? (isSkipped ? 'SKIPPED' : 'PASS') : 'FAIL';

  if (passed) {
    console.log(`${status} (${durationMs}ms)`);
    results.push({
      Suite: suite.name,
      Tier: suite.tier,
      Status: status,
      Duration: `${durationMs}ms`,
      ExitCode: 0
    });
  } else {
    console.log(`FAIL (${durationMs}ms)`);
    console.error('\n--- STDERR / OUTPUT ---');
    console.error(run.stdout);
    console.error(run.stderr);
    results.push({
      Suite: suite.name,
      Tier: suite.tier,
      Status: 'FAIL',
      Duration: `${durationMs}ms`,
      ExitCode: run.status
    });
    overallPass = false;
  }
}

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n================================================================');
console.log('                     QA TEST EXECUTION SUMMARY                  ');
console.log('================================================================');
console.table(results);
console.log(`Total Execution Time: ${totalDuration}s`);
console.log(`Overall Result: ${overallPass ? 'ALL EXECUTED SUITES PASSED' : 'SOME TESTS FAILED'}`);
console.log('================================================================\n');

process.exit(overallPass ? 0 : 1);
