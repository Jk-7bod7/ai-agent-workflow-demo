/**
 * Master Test Runner & Quality Assurance Suite
 * Executes unit, integration, chaos, e2e, and security tests.
 */

const { spawnSync } = require('node:child_process');
const path = require('path');

const SUITES = [
  { name: 'Workflow Graph & Schema Validation', script: 'validate-workflow.js' },
  { name: 'Unit: Data Validation & Normalization', script: 'tests/unit/validation.test.js' },
  { name: 'Unit: Priority Scoring & SLA Calculation', script: 'tests/unit/scoring.test.js' },
  { name: 'Integration: Mock CRM REST API & Idempotency', script: 'tests/integration/crm-api.test.js' },
  { name: 'Integration: Chaos & Bounded Retry Recovery', script: 'tests/integration/chaos-retry.test.js' },
  { name: 'E2E: Full Pipeline & Persistence Across Restarts', script: 'tests/e2e/e2e-pipeline.test.js' },
  { name: 'Security: Zero-Secrets & Credentials Audit', script: 'tests/security/security-scan.test.js' }
];

console.log('================================================================');
console.log('  INTELLIGENT LEAD-TO-CRM SYSTEM: AUTOMATED QA TEST RUNNER');
console.log('================================================================\n');

const results = [];
let overallPass = true;
const startTime = Date.now();

for (const suite of SUITES) {
  const scriptPath = path.join(__dirname, suite.script);
  process.stdout.write(`Executing: ${suite.name}... `);
  const suiteStart = Date.now();

  const run = spawnSync('node', [scriptPath], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test' }
  });

  const durationMs = Date.now() - suiteStart;
  const passed = run.status === 0;

  if (passed) {
    console.log(`PASS (${durationMs}ms)`);
    results.push({ Suite: suite.name, Status: 'PASS', Duration: `${durationMs}ms`, ExitCode: 0 });
  } else {
    console.log(`FAIL (${durationMs}ms)`);
    console.error('\n--- STDERR / OUTPUT ---');
    console.error(run.stdout);
    console.error(run.stderr);
    results.push({ Suite: suite.name, Status: 'FAIL', Duration: `${durationMs}ms`, ExitCode: run.status });
    overallPass = false;
  }
}

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

console.log('\n================================================================');
console.log('                     QA TEST EXECUTION SUMMARY                  ');
console.log('================================================================');
console.table(results);
console.log(`Total Execution Time: ${totalDuration}s`);
console.log(`Overall Result: ${overallPass ? 'ALL TESTS PASSED (100% GREEN)' : 'SOME TESTS FAILED'}`);
console.log('================================================================\n');

process.exit(overallPass ? 0 : 1);
