"""
Lambda handler for the multi-agent support UI.

Request:  POST /api  { "scenarioId": "multi_concern" }
Response: {
  "trace":            [...],   # Animation steps for flow diagram
  "messages":         [...],   # Full coordinator message history (conversation panel)
  "final_response":   "...",   # Coordinator's final text
  "subagent_results": {...},   # Per-actor results (for detail view)
}

The Lambda Function URL has AuthType: AWS_IAM — not publicly accessible.
Requests are signed by the Lambda@Edge function in edge-signer/.
"""

import json
import os

from agent.coordinator_traced import run_coordinator_for_web

SCENARIOS: dict[str, dict] = {
    "multi_concern": {
        "message": (
            "Hi, I'm Alice Johnson (alice@example.com). I have three issues today: "
            "1) My order ORD-1001 (Laptop Stand) arrived damaged — I need a full refund please. "
            "2) My order ORD-1002 (USB-C Hub) has been in transit for 2 weeks — "
            "can you check the status? "
            "3) I saw a competitor selling your 4K Monitor for $50 less — "
            "can TechCo match that price?"
        ),
        "session_id": "web_multi_concern",
        "description": "Three parallel concerns: refund, order status, price match",
    },
    "single_refund": {
        "message": (
            "Hi, I'm Bob Smith (bob@example.com). "
            "My order ORD-1003 (Mechanical Keyboard) arrived with broken keys. "
            "I'd like a full refund please."
        ),
        "session_id": "web_single_refund",
        "description": "Single concern: refund for damaged item",
    },
}


def handler(event: dict, context) -> dict:
    """AWS Lambda entry point."""
    try:
        body = _parse_body(event)
        scenario_id = body.get("scenarioId", "multi_concern")

        scenario = SCENARIOS.get(scenario_id)
        if not scenario:
            return _error(400, f"Unknown scenarioId: {scenario_id}. Valid: {list(SCENARIOS.keys())}")

        result = run_coordinator_for_web(
            user_message=scenario["message"],
            session_id=scenario["session_id"],
        )

        return {
            "statusCode": 200,
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
            "body": json.dumps({
                "trace": result.trace,
                "messages": result.messages,
                "final_response": result.final_response,
                "subagent_results": result.subagent_results,
                "scenario": {
                    "id": scenario_id,
                    "description": scenario["description"],
                    "message": scenario["message"],
                },
            }),
        }

    except Exception as exc:
        return _error(500, str(exc))


def _parse_body(event: dict) -> dict:
    body = event.get("body", "{}")
    if isinstance(body, str):
        return json.loads(body)
    return body or {}


def _error(status: int, message: str) -> dict:
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps({"error": message}),
    }
