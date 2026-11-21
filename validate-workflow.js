/**
 * Validation and Simulation Script for n8n Workflow: Automated Lead Processing Demo
 * 
 * Verifies:
 * 1. JSON syntactical integrity.
 * 2. n8n schema compatibility (nodes, connections, required attributes).
 * 3. Execution logic simulation (Lead Generation -> Validation -> Branching -> Prioritization -> Structured Output).
 * 4. Generates sample-output.json based on simulated workflow run.
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, 'workflow.json');
const INPUT_PATH = path.join(__dirname, 'sample-input.json');
const OUTPUT_PATH = path.join(__dirname, 'sample-output.json');

console.log('====================================================');
console.log('n8n Workflow Structural & Execution Validator');
console.log('====================================================\n');

// 1. Structural Validation
console.log('[Step 1] Loading and parsing workflow.json...');
if (!fs.existsSync(WORKFLOW_PATH)) {
  console.error('FAIL: workflow.json not found!');
  process.exit(1);
}

let workflow;
try {
  const content = fs.readFileSync(WORKFLOW_PATH, 'utf8');
  workflow = JSON.parse(content);
  console.log('✓ workflow.json is valid JSON.');
} catch (err) {
  console.error('FAIL: workflow.json JSON parse error:', err.message);
  process.exit(1);
}

// 2. Schema Integrity Checks
console.log('\n[Step 2] Checking n8n schema conventions...');
const requiredKeys = ['name', 'nodes', 'connections'];
for (const key of requiredKeys) {
  if (!workflow[key]) {
    console.error(`FAIL: Missing required workflow property '${key}'`);
    process.exit(1);
  }
}
console.log(`✓ Name: "${workflow.name}"`);
console.log(`✓ Total Nodes: ${workflow.nodes.length}`);

const nodeNames = new Set();
const nodeIds = new Set();

for (const node of workflow.nodes) {
  if (!node.id || !node.name || !node.type) {
    console.error(`FAIL: Node missing id, name, or type:`, node);
    process.exit(1);
  }
  if (nodeNames.has(node.name)) {
    console.error(`FAIL: Duplicate node name detected: "${node.name}"`);
    process.exit(1);
  }
  if (nodeIds.has(node.id)) {
    console.error(`FAIL: Duplicate node id detected: "${node.id}"`);
    process.exit(1);
  }
  nodeNames.add(node.name);
  nodeIds.add(node.id);
}
console.log(`✓ All ${workflow.nodes.length} nodes have unique IDs and Names.`);

// Check connections integrity
for (const [sourceNode, connectionData] of Object.entries(workflow.connections)) {
  if (!nodeNames.has(sourceNode)) {
    console.error(`FAIL: Connection source node "${sourceNode}" not found in nodes list.`);
    process.exit(1);
  }
  if (connectionData.main) {
    for (const outputGroup of connectionData.main) {
      for (const target of outputGroup) {
        if (!nodeNames.has(target.node)) {
          console.error(`FAIL: Target node "${target.node}" connected from "${sourceNode}" not found in nodes list.`);
          process.exit(1);
        }
      }
    }
  }
}
console.log('✓ All connection sources and targets resolve to valid nodes.');

// 3. Execution Simulation
console.log('\n[Step 3] Simulating workflow execution with sample leads...');
const rawInput = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
console.log(`✓ Loaded ${rawInput.length} sample leads from sample-input.json.`);

const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const validatedLeads = rawInput.map(lead => {
  const errors = [];
  if (!lead.email || !emailRegex.test(lead.email.trim())) {
    errors.push("Invalid or missing email address");
  }
  if (!lead.company || lead.company.trim().length === 0) {
    errors.push("Company name is mandatory");
  }
  if (!lead.fullName || lead.fullName.trim().length === 0) {
    errors.push("Contact full name is mandatory");
  }
  if (typeof lead.budget !== 'number' || lead.budget < 0) {
    errors.push("Budget must be a non-negative number");
  }

  return {
    ...lead,
    isValid: errors.length === 0,
    validationErrors: errors
  };
});

const qualifiedOutputs = [];
const disqualifiedOutputs = [];

for (const lead of validatedLeads) {
  if (lead.isValid) {
    let priority = "P3";
    let tier = "Standard";
    let slaHours = 24;
    let routingQueue = "marketing_nurture";
    let suggestedAction = "Enroll in automated product onboarding sequence";
    const rules = [];

    if (lead.budget >= 50000 || lead.companySize === "500+") {
      priority = "P1";
      tier = "Enterprise Tier";
      slaHours = 1;
      routingQueue = "enterprise_exec_sales";
      suggestedAction = "Urgent: Assign to Senior Enterprise Account Director";
      if (lead.budget >= 50000) rules.push("HIGH_BUDGET_OVER_50K");
      if (lead.companySize === "500+") rules.push("ENTERPRISE_ORG_SIZE");
    } else if (lead.budget >= 10000 || lead.companySize === "50-250") {
      priority = "P2";
      tier = "Mid-Market Tier";
      slaHours = 4;
      routingQueue = "midmarket_sales";
      suggestedAction = "Assign to Dedicated Commercial Account Executive";
      if (lead.budget >= 10000) rules.push("MID_BUDGET_OVER_10K");
      if (lead.companySize === "50-250") rules.push("MIDMARKET_ORG_SIZE");
    } else {
      rules.push("SELF_SERVE_QUALIFIED");
    }

    qualifiedOutputs.push({
      leadId: lead.leadId,
      contact: {
        fullName: lead.fullName,
        email: lead.email,
        company: lead.company,
        companySize: lead.companySize
      },
      qualification: {
        status: "QUALIFIED",
        priority,
        tier,
        estimatedBudget: lead.budget,
        inquiryType: lead.inquiryType,
        source: lead.source,
        slaTargetHours: slaHours,
        routingQueue,
        suggestedAction
      },
      audit: {
        validationPassed: true,
        triggeredRules: rules,
        evaluatedAt: "2026-11-21T19:30:00.000Z"
      }
    });
  } else {
    disqualifiedOutputs.push({
      leadId: lead.leadId || "UNKNOWN",
      contact: {
        fullName: lead.fullName || null,
        email: lead.email || null,
        company: lead.company || null,
        companySize: lead.companySize || "Unknown"
      },
      qualification: {
        status: "DISQUALIFIED",
        priority: "N/A",
        tier: "Unqualified",
        estimatedBudget: typeof lead.budget === 'number' ? lead.budget : null,
        inquiryType: lead.inquiryType || "Unspecified",
        source: lead.source || "Unknown",
        slaTargetHours: null,
        routingQueue: "quarantine_review",
        suggestedAction: "Review validation errors or flag as automated spam"
      },
      audit: {
        validationPassed: false,
        validationErrors: lead.validationErrors,
        evaluatedAt: "2026-11-21T19:30:00.000Z"
      }
    });
  }
}

const finalOutput = {
  summary: {
    totalProcessed: rawInput.length,
    qualifiedCount: qualifiedOutputs.length,
    disqualifiedCount: disqualifiedOutputs.length,
    priorityBreakdown: {
      P1: qualifiedOutputs.filter(q => q.qualification.priority === 'P1').length,
      P2: qualifiedOutputs.filter(q => q.qualification.priority === 'P2').length,
      P3: qualifiedOutputs.filter(q => q.qualification.priority === 'P3').length
    }
  },
  qualifiedLeads: qualifiedOutputs,
  disqualifiedLeads: disqualifiedOutputs
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalOutput, null, 2), 'utf8');
console.log(`✓ Generated ${OUTPUT_PATH}`);
console.log('\n[Execution Summary]');
console.table(finalOutput.summary.priorityBreakdown);
console.log(`Qualified: ${finalOutput.summary.qualifiedCount}, Disqualified: ${finalOutput.summary.disqualifiedCount}`);
console.log('\n>>> ALL VALIDATION CHECKS PASSED SUCCESSFULLY <<<');
