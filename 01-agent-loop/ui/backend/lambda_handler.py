"""
AWS Lambda handler — entry point for all API requests from the web UI.

Each request carries a scenarioId. The handler runs the corresponding
agent scenario and returns the full conversation as structured JSON.
"""

import json
import os
import traceback
from agent.agent_loop import run_agent_for_web
from extraction.case_extractor import extract_case_for_web

SCENARIOS = {
    "standard_refund": {
        "id": "standard_refund",
        "type": "agent",
        "message": (
            "Hi, my name is Alice Johnson (alice@example.com). "
            "I received order ORD-1001 but the laptop stand arrived damaged. "
            "I'd like a refund please."
        ),
    },
    "large_refund": {
        "id": "large_refund",
        "type": "agent",
        "message": (
            "I'm Bob Smith (bob@example.com). I bought a 4K monitor (ORD-1003) "
            "for $799.99 and it stopped working after a week. I want a full refund."
        ),
    },
    "explicit_escalation": {
        "id": "explicit_escalation",
        "type": "agent",
        "message": (
            "I don't want to talk to a bot. Get me a human agent right now. "
            "I have order ORD-1001 and I'm very unhappy."
        ),
    },
    "multi_concern": {
        "id": "multi_concern",
        "type": "agent",
        "message": (
            "Alice here (alice@example.com). I have two issues: "
            "First, my order ORD-1001 (laptop stand) arrived damaged and I want a refund. "
            "Second, my account seems to be showing the wrong email address. Can you help?"
        ),
    },
    "structured_extraction": {
        "id": "structured_extraction",
        "type": "extraction",
        "conversation": (
            "Customer: Hi, I bought something last week but I can't remember the order number. "
            "I want to return it.\n"
            "Agent: I'd be happy to help. Could you verify your email address so I can look up your account?\n"
            "Customer: It's alice@example.com\n"
            "Agent: I found your account, Alice. I can see order ORD-1001 for a laptop stand delivered "
            "on January 10th. It is within the return window. I'll process your refund of $129.99. "
            "Your confirmation number is REF-ABC12345.\n"
            "Customer: Great, thank you!"
        ),
    },
}

RESPONSE_HEADERS = {
    "Content-Type": "application/json",
}

CF_SECRET = os.getenv("CF_SECRET", "")


def lambda_handler(event, context):
    # Validate the request came through CloudFront (shared secret check)
    headers = event.get("headers", {})
    if CF_SECRET and headers.get("x-cf-secret") != CF_SECRET:
        return {
            "statusCode": 403,
            "headers": RESPONSE_HEADERS,
            "body": json.dumps({"error": "Forbidden"}),
        }

    try:
        body = json.loads(event.get("body") or "{}")
        scenario_id = body.get("scenarioId", "").strip()

        if not scenario_id:
            return _error(400, "Missing required field: scenarioId")

        if scenario_id not in SCENARIOS:
            return _error(400, f"Unknown scenario '{scenario_id}'. Valid options: {list(SCENARIOS.keys())}")

        scenario = SCENARIOS[scenario_id]

        if scenario["type"] == "extraction":
            result = extract_case_for_web(scenario["conversation"])
        else:
            result = run_agent_for_web(scenario["message"], session_id=scenario_id)

        return {
            "statusCode": 200,
            "headers": RESPONSE_HEADERS,
            "body": json.dumps(result),
        }

    except Exception as exc:
        return _error(500, str(exc), detail=traceback.format_exc())


def _error(status: int, message: str, detail: str = "") -> dict:
    body = {"error": message}
    if detail:
        body["detail"] = detail
    return {"statusCode": status, "headers": RESPONSE_HEADERS, "body": json.dumps(body)}
