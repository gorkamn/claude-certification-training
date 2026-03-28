"""
Scratchpad — Domain 5, Task 5.4 exam focus areas:

EXAM CONCEPT: Context degradation in extended multi-agent sessions.
Multiple subagents write their findings here so the coordinator can read
concise summaries instead of verbose tool outputs.

EXAM CONCEPT (Task 5.4): Subagent delegation + scratchpad.
  - Spawn subagents for specific investigation questions
  - Have each subagent write its key findings to the scratchpad
  - Main coordinator reads scratchpad summaries, not verbose tool outputs

EXAM CONCEPT (Task 5.4): Structured state persistence for crash recovery.
  - Each agent exports state to a known location (scratchpad)
  - On resume, the coordinator loads the scratchpad and injects it into initial context
  - This enables crash recovery without re-running the entire investigation

MULTI-AGENT NOTE: threading.Lock added here because multiple subagents write
concurrently (via ThreadPoolExecutor in coordinator.py). Without the lock,
concurrent writes can corrupt the JSON file.
"""

import json
import os
import threading
from datetime import datetime
from pathlib import Path


class Scratchpad:
    """
    Persistent scratchpad for preserving key findings across context limits.

    In a multi-agent system, each subagent writes to its section;
    the coordinator reads all sections for synthesis.

    EXAM CONCEPT: threading.Lock required because coordinator spawns
    multiple subagents in parallel (ThreadPoolExecutor) — they all write
    to the same scratchpad file simultaneously without a lock.
    """

    _lock = threading.Lock()  # Class-level lock for concurrent subagent writes

    def __init__(self, session_id: str, base_dir: str = ".scratch"):
        self.session_id = session_id
        self.path = Path(base_dir) / f"{session_id}.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._data: dict = self._load()

    def _load(self) -> dict:
        if self.path.exists():
            with open(self.path) as f:
                return json.load(f)
        return {
            "session_id": self.session_id,
            "created_at": datetime.now().isoformat(),
            "facts": {},
            "findings": [],
            "agent_states": {},
        }

    def _save(self) -> None:
        # EXAM CONCEPT: Lock required for parallel subagent writes.
        # Without this, two subagents completing simultaneously could
        # corrupt the JSON file (partial writes overlapping).
        with Scratchpad._lock:
            with open(self.path, "w") as f:
                json.dump(self._data, f, indent=2)

    def update(self, facts: dict) -> None:
        """
        Update the scratchpad with newly discovered facts.
        Called after each agent interaction to persist critical data.
        """
        self._data["facts"].update(facts)
        self._data["last_updated"] = datetime.now().isoformat()
        self._save()

    def add_finding(self, agent: str, finding: str, metadata: dict | None = None) -> None:
        """
        EXAM CONCEPT (Task 5.4): Record a key finding from a subagent.
        The coordinator references these without needing to re-read verbose tool outputs.
        """
        self._data["findings"].append({
            "timestamp": datetime.now().isoformat(),
            "agent": agent,
            "finding": finding,
            "metadata": metadata or {},
        })
        self._save()

    def save_agent_state(self, agent_name: str, state: dict) -> None:
        """
        EXAM CONCEPT (Task 5.4): Structured state persistence for crash recovery.
        Each agent exports its state here. On resume, coordinator loads this
        manifest and injects the state into new agent prompts.
        """
        self._data["agent_states"][agent_name] = {
            "saved_at": datetime.now().isoformat(),
            "state": state,
        }
        self._save()

    def get_resume_context(self) -> str:
        """
        Generate a summary for session resumption.
        When resuming after stale tool results, inject this summary into the
        initial context rather than replaying the entire conversation.
        """
        facts = self._data.get("facts", {})
        findings = self._data.get("findings", [])

        lines = [
            f"## Resuming Session: {self.session_id}",
            f"Last updated: {self._data.get('last_updated', 'unknown')}",
            "",
        ]

        if facts:
            lines.append("### Verified Facts from Prior Session")
            for k, v in facts.items():
                lines.append(f"  - {k}: {v}")
            lines.append("")

        if findings:
            lines.append("### Key Findings from Prior Investigation")
            for f in findings[-10:]:  # Last 10 findings to stay concise
                lines.append(f"  [{f['agent']}] {f['finding']}")
            lines.append("")

        agent_states = self._data.get("agent_states", {})
        if agent_states:
            lines.append("### Agent States (for crash recovery)")
            for agent, state_data in agent_states.items():
                lines.append(f"  {agent}: last active {state_data['saved_at']}")
            lines.append("")

        return "\n".join(lines)

    @property
    def facts(self) -> dict:
        return self._data.get("facts", {})

    def get_all_findings(self) -> list[dict]:
        """Return all findings — used by coordinator for synthesis."""
        return self._data.get("findings", [])

    def clear(self) -> None:
        """Clear the scratchpad for a fresh session."""
        self._data = {
            "session_id": self.session_id,
            "created_at": datetime.now().isoformat(),
            "facts": {},
            "findings": [],
            "agent_states": {},
        }
        self._save()
