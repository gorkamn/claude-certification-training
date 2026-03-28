<!--
EXAM CONCEPT (Task 3.2): Project-scoped slash commands in .claude/commands/
Commands here are version-controlled and available to ALL developers on clone/pull.
Personal commands go in ~/.claude/commands/ and are NOT shared.

Usage: /review-case ORD-1001
-->

# Review Support Case

Review the support case for the given order or customer ID. Check:

1. **Tool sequence compliance**: Was get_customer called before lookup_order?
2. **Error handling**: Were structured errors returned with errorCategory and isRetryable?
3. **Escalation logic**: Was escalation triggered by the correct criteria (not sentiment)?
4. **Context preservation**: Were case facts persisted outside summarized history?
5. **Hook enforcement**: For refunds > $500, was the pre-tool hook triggered?

Argument: $ARGUMENTS (order ID or customer ID to review)

If no argument provided, review the most recent case in the escalation log.
