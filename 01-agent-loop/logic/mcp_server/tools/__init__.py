from . import get_customer, lookup_order, process_refund, escalate_to_human

# All tool definitions — passed to the Anthropic API as the `tools` parameter
ALL_TOOLS = [
    get_customer.TOOL_DEFINITION,
    lookup_order.TOOL_DEFINITION,
    process_refund.TOOL_DEFINITION,
    escalate_to_human.TOOL_DEFINITION,
]

# Dispatch table for executing tool calls by name
TOOL_EXECUTORS = {
    "get_customer": lambda args: get_customer.execute(**args),
    "lookup_order": lambda args: lookup_order.execute(**args),
    "process_refund": lambda args: process_refund.execute(**args),
    "escalate_to_human": lambda args: escalate_to_human.execute(**args),
}
