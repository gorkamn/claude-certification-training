"""
MCP Server — exposes TechCo support tools over the MCP protocol.

EXAM CONCEPT (Task 2.4): MCP servers make tools available to Claude Code CLI.
When `claude` starts and reads .mcp.json, it launches this server as a subprocess
and discovers the tools via the MCP protocol. Claude Code then references them as:
  mcp__support-tools__get_customer
  mcp__support-tools__lookup_order
  mcp__support-tools__process_refund
  mcp__support-tools__escalate_to_human

TRACK 1 (Python SDK):
  This file is NOT used. The tools are imported directly in Python:
    from mcp_server.tools import ALL_TOOLS, TOOL_EXECUTORS

TRACK 2 (Claude Code CLI):
  This file IS used. Claude Code starts it as: python -m mcp_server.server
  The MCP protocol bridges Claude Code's native tool calls to our Python functions.
"""

import json
import sys
from typing import Any

# Minimal MCP server implementation using stdio transport
# In production, use the official `mcp` Python SDK:
#   from mcp.server import Server
#   from mcp.server.stdio import stdio_server

# For this exam project: a lightweight stdio MCP server
from mcp_server.tools import TOOL_EXECUTORS, ALL_TOOLS


def send_response(response: dict) -> None:
    """Write a JSON-RPC response to stdout."""
    line = json.dumps(response) + "\n"
    sys.stdout.write(line)
    sys.stdout.flush()


def handle_request(request: dict) -> dict | None:
    """Handle a single MCP JSON-RPC request."""
    method = request.get("method", "")
    req_id = request.get("id")

    # MCP initialization handshake
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "support-tools", "version": "1.0.0"},
            },
        }

    # Tool discovery — Claude Code calls this to learn what tools are available
    if method == "tools/list":
        mcp_tools = []
        for tool in ALL_TOOLS:
            mcp_tools.append({
                "name": tool["name"],
                "description": tool["description"],
                "inputSchema": tool["input_schema"],
            })
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": mcp_tools},
        }

    # Tool execution — Claude Code calls a tool
    if method == "tools/call":
        params = request.get("params", {})
        tool_name = params.get("name", "")
        tool_args = params.get("arguments", {})

        executor = TOOL_EXECUTORS.get(tool_name)
        if not executor:
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"},
            }

        result = executor(tool_args)
        is_error = result.get("isError", False)
        content_text = result.get("content", [{}])[0].get("text", "")

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "content": [{"type": "text", "text": content_text}],
                "isError": is_error,
            },
        }

    # Notifications (no response needed)
    if method.startswith("notifications/"):
        return None

    # Unknown method
    if req_id is not None:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    return None


def main() -> None:
    """Run the MCP server on stdio."""
    # Force UTF-8 for Windows
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stdin.reconfigure(encoding="utf-8")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            response = handle_request(request)
            if response is not None:
                send_response(response)
        except json.JSONDecodeError:
            send_response({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "Parse error"},
            })
        except Exception as exc:
            send_response({
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32603, "message": f"Internal error: {exc}"},
            })


if __name__ == "__main__":
    main()
