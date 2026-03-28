---
# EXAM CONCEPT (Task 3.2): Skill frontmatter options
#
# context: fork
#   Runs this skill in an ISOLATED sub-agent context.
#   Prevents verbose skill output from polluting the main conversation context.
#   Use when: skill produces lots of exploratory output you don't want in main session.
#   Example: codebase analysis, brainstorming, batch summarization.
#
# allowed-tools
#   Restricts which tools are available during skill execution.
#   Prevents destructive actions; limits scope to what the skill actually needs.
#
# argument-hint
#   Shown to the developer when they invoke the skill without arguments.
#   Guides them to provide required parameters.
#
# KEY EXAM DISTINCTION:
#   Skills (on-demand invocation) vs CLAUDE.md (always-loaded universal standards)
#   Use skills for task-specific, on-demand workflows.
#   Use CLAUDE.md for conventions that should always apply.

context: fork
allowed-tools: Read, Grep, Glob
argument-hint: "Provide a case transcript or conversation ID to analyze"
---

# Analyze Support Ticket

Analyze the provided support ticket transcript and produce a structured case review.

## Instructions

Given the transcript in $ARGUMENTS (or the conversation above), extract and report:

### 1. Case Classification
- Primary intent (refund/return/order status/account/billing/other)
- Customer sentiment (positive/neutral/frustrated/angry)
- Resolution status (resolved/escalated/pending)

### 2. Tool Usage Audit
- Were tools called in the correct sequence? (get_customer → lookup_order → process_refund)
- Were any verification steps skipped?
- Were structured errors returned correctly?

### 3. Escalation Decision Audit
- Was the escalation trigger correct? (explicit request / policy gap / threshold / unable to progress)
- Was sentiment incorrectly used as the escalation trigger? (flag this as a defect)
- Was the escalation summary complete? (customer ID, root cause, recommended action)

### 4. Context Management
- Were case facts (amounts, order IDs) preserved in a structured block?
- Were tool outputs trimmed to relevant fields?

### 5. Recommendations
List any issues found and suggested improvements.

Output the analysis as a structured markdown report.
Note: This skill runs in isolated context (context: fork) so its output
does not accumulate in your main session.
