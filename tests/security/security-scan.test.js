/**
 * Security Audit & Secrets Scan Test Suite
 */

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

console.log('--- Running Security Audit & Secret Scanning ---');

const PROJECT_DIR = path.resolve(__dirname, '../../');
const IGNORE_DIRS = new Set(['.git', 'node_modules', 'data']);

const SENSITIVE_PATTERNS = [
  { name: 'GitHub Personal Access Token', regex: /gh[pousr]_[a-zA-Z0-9]{36,}/ },
  { name: 'GitHub Fine-grained PAT', regex: /github_pat_[a-zA-Z0-9_]{30,}/ },
  { name: 'OpenAI Secret Key', regex: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Google API Key', regex: /AIza[0-9A-Za-z-_]{35}/ },
  { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Private Key PEM', regex: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/ },
  { name: 'Hardcoded Secret Assignment', regex: /(api_key|apiKey|secret_key|secretKey)\s*[:=]\s*['"][a-zA-Z0-9_-]{16,}['"]/i }
];

let scannedCount = 0;
const findings = [];

function scanDirectory(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(PROJECT_DIR, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        scanDirectory(fullPath);
      }
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.sqlite') || entry.name.endsWith('.png') || entry.name.endsWith('.jpg')) {
        continue;
      }
      scannedCount++;
      const content = fs.readFileSync(fullPath, 'utf8');

      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.regex.test(content)) {
          findings.push({
            file: relPath,
            rule: pattern.name
          });
        }
      }
    }
  }
}

scanDirectory(PROJECT_DIR);
console.log(`✓ Scanned ${scannedCount} project files across all directories.`);

if (findings.length > 0) {
  console.error('❌ CRITICAL: Security secrets detected in repository:');
  console.table(findings);
  assert.fail(`Detected ${findings.length} secret exposures!`);
} else {
  console.log('✓ 0 Secrets or sensitive credentials detected.');
  console.log('All Security Audit Tests Passed Successfully.\n');
}
