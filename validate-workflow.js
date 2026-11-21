/**
 * Structural & Graph Validation Script for n8n Workflows
 * Verifies both workflow.json and sla-monitor-workflow.json
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_FILES = [
  'workflow.json',
  'sla-monitor-workflow.json'
];

console.log('--- Validating n8n Workflow Definitions ---');

for (const file of WORKFLOW_FILES) {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.error(`FAIL: File not found: ${file}`);
    process.exit(1);
  }

  let workflow;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    workflow = JSON.parse(content);
  } catch (err) {
    console.error(`FAIL: ${file} is not valid JSON:`, err.message);
    process.exit(1);
  }

  // Schema checks
  const requiredKeys = ['name', 'nodes', 'connections'];
  for (const k of requiredKeys) {
    if (!workflow[k]) {
      console.error(`FAIL: ${file} missing required key '${k}'`);
      process.exit(1);
    }
  }

  const nodeNames = new Set();
  const nodeIds = new Set();

  for (const node of workflow.nodes) {
    if (!node.id || !node.name || !node.type) {
      console.error(`FAIL: Node missing required attributes in ${file}:`, node);
      process.exit(1);
    }
    if (nodeNames.has(node.name)) {
      console.error(`FAIL: Duplicate node name in ${file}: ${node.name}`);
      process.exit(1);
    }
    if (nodeIds.has(node.id)) {
      console.error(`FAIL: Duplicate node id in ${file}: ${node.id}`);
      process.exit(1);
    }
    nodeNames.add(node.name);
    nodeIds.add(node.id);
  }

  // Connection resolution
  for (const [sourceNode, connData] of Object.entries(workflow.connections)) {
    if (!nodeNames.has(sourceNode)) {
      console.error(`FAIL: Connection source "${sourceNode}" not in nodes list (${file})`);
      process.exit(1);
    }
    if (connData.main) {
      for (const group of connData.main) {
        for (const target of group) {
          if (!nodeNames.has(target.node)) {
            console.error(`FAIL: Target node "${target.node}" not found in nodes list (${file})`);
            process.exit(1);
          }
        }
      }
    }
  }

  console.log(`✓ ${file}: Validated ${workflow.nodes.length} nodes and connection graph.`);
}

console.log('All Workflow JSON Graph Validations Passed.\n');
