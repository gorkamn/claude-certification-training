"""
Multi-Agent Support Demo

This demo shows the multi-agent coordinator/subagent pattern in action.
Compare with ../../../01-agent-loop/logic/demo.py to see the contrast between:
  - Single-agent loop (that project)
  - Multi-agent coordinator with parallel subagents (this project)

TRACK 1 (Python SDK): Run this file with:
  cd 02-multi-agent/logic
  python demo.py

TRACK 2 (Claude Code CLI): Run with the coordinator skill:
  cd 02-multi-agent/logic
  claude
  /multi-agent-coordinator Hi, I'm Alice Johnson (alice@example.com)...
"""

import sys

# Force UTF-8 output on Windows to handle unicode in responses
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv

load_dotenv(override=True)

from agent.coordinator import run_coordinator  # noqa: E402


def run_demo(title: str, message: str, session_id: str) -> None:
    """Run a demo scenario with clear headers."""
    print(f"\n{'='*70}")
    print(f"DEMO: {title}")
    print(f"{'='*70}")
    result = run_coordinator(message, session_id=session_id)
    print(f"\n{'='*70}")
    print(f"FINAL RESPONSE:\n{result}")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    run_demo(
        title="Multi-Concern Case: Refund + Order Status + Price Match",
        message=(
            "Hi, I'm Alice Johnson (alice@example.com). I have three issues today: "
            "1) My order ORD-1001 (Laptop Stand) arrived damaged — I need a full refund please. "
            "2) My order ORD-1002 (USB-C Hub) has been in transit for 2 weeks — "
            "can you check the status? "
            "3) I saw a competitor selling your 4K Monitor for $50 less — "
            "can TechCo match that price?"
        ),
        session_id="demo_multi_concern",
    )
