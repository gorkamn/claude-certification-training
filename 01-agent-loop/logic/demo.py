"""
End-to-end demo — runs the support agent against test scenarios that exercise
every exam domain. Run with: python demo.py

Each scenario tests specific exam concepts. Read the output carefully —
the [HOOK], [Iteration N], and stop_reason logs show the concepts in action.
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv(override=True)

# Verify API key is set
if not os.getenv("ANTHROPIC_API_KEY"):
    print("ERROR: Set ANTHROPIC_API_KEY in .env file first.")
    print("Copy .env.example to .env and add your key.")
    sys.exit(1)

from agent.agent_loop import run_agent  # noqa: E402
from extraction.case_extractor import extract_case_summary  # noqa: E402


def run_scenario(title: str, message: str, session_id: str = None):
    print(f"\n{'#'*70}")
    print(f"# SCENARIO: {title}")
    print(f"{'#'*70}")
    return run_agent(message, session_id=session_id or title.lower().replace(" ", "_"))


def demo_extraction(title: str, conversation: str):
    print(f"\n{'#'*70}")
    print(f"# EXTRACTION: {title}")
    print(f"{'#'*70}")
    return extract_case_summary(conversation)


if __name__ == "__main__":
    print("=" * 64)
    print("  TechCo Customer Support Agent -- Certification Training Demo")
    print("  Covers all 5 exam domains. Watch the logs carefully.")
    print("=" * 64)
    print()

    # =========================================================================
    # SCENARIO 1: Standard refund (Domain 1 + 2)
    # Tests: get_customer → lookup_order → process_refund sequence
    # Tests: tool descriptions differentiating similar tools
    # =========================================================================
    run_scenario(
        "Standard Refund Request",
        "Hi, my name is Alice Johnson (alice@example.com). "
        "I received order ORD-1001 but the laptop stand arrived damaged. "
        "I'd like a refund please.",
    )

    # =========================================================================
    # SCENARIO 2: Large refund — hook interception (Domain 1, Task 1.5)
    # Tests: pre_tool_use hook blocks process_refund above $500
    # Tests: programmatic enforcement vs prompt instructions
    # =========================================================================
    run_scenario(
        "Large Refund — Hook Interception",
        "I'm Bob Smith (bob@example.com). I bought a 4K monitor (ORD-1003) "
        "for $799.99 and it stopped working after a week. I want a full refund.",
        "large_refund"
    )

    # =========================================================================
    # SCENARIO 3: Explicit escalation request (Domain 5, Task 5.2)
    # Tests: honoring customer_requested_human immediately
    # Tests: NOT using sentiment as escalation trigger
    # =========================================================================
    run_scenario(
        "Explicit Human Request",
        "I don't want to talk to a bot. Get me a human agent right now. "
        "I have order ORD-1001 and I'm very unhappy.",
        "explicit_escalation"
    )

    # =========================================================================
    # SCENARIO 4: Multi-concern request (Domain 1, Task 1.4)
    # Tests: decomposing multi-concern requests, investigating in parallel,
    # synthesizing a unified response
    # =========================================================================
    run_scenario(
        "Multi-Concern Request",
        "Alice here (alice@example.com). I have two issues: "
        "First, my order ORD-1001 (laptop stand) arrived damaged and I want a refund. "
        "Second, my account seems to be showing the wrong email address. Can you help?",
        "multi_concern"
    )

    # =========================================================================
    # SCENARIO 5: Structured extraction (Domain 4, Tasks 4.3 & 4.4)
    # Tests: tool_use with JSON schema, nullable fields, validation-retry loop
    # =========================================================================
    sample_conversation = """
Customer: Hi, I bought something last week but I can't remember the order number.
          I want to return it.
Agent: I'd be happy to help. Could you verify your email address so I can look up your account?
Customer: It's alice@example.com
Agent: I found your account, Alice. I can see order ORD-1001 for a laptop stand delivered
       on January 10th. It is within the return window. I'll process your refund of $129.99.
       Your confirmation number is REF-ABC12345.
Customer: Great, thank you!
"""

    demo_extraction("Conversation to Structured Data", sample_conversation)

    print(f"\n{'='*70}")
    print("Demo complete. Review the logs above to understand each concept.")
    print("Each [HOOK], stop_reason, and iteration log corresponds to an exam topic.")
    print(f"{'='*70}\n")
