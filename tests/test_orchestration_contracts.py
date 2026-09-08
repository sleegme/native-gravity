#!/usr/bin/env python3
"""Behavioral contract tests for Native Gravity agents, rules, and orchestration."""

from pathlib import Path
import unittest
import yaml

ROOT = Path(__file__).resolve().parents[1]
AGENTS_DIR = ROOT / "agents"
RULES_DIR = ROOT / "rules"


def load_agent(name: str) -> tuple[dict, str]:
    path = AGENTS_DIR / f"{name}.md"
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    parts = content.split("---", 2)
    self_frontmatter = yaml.safe_load(parts[1])
    body = parts[2] if len(parts) > 2 else ""
    return self_frontmatter, body


class AgentGraphAndBoundaryTests(unittest.TestCase):
    def test_all_rewritten_targets_exist(self) -> None:
        expected_agents = [
            "bulldozer", "piledriver", "excavator",
            "bobcat", "puma", "jaguar", "steamroller", "strix-halo", "zen"
        ]
        for name in expected_agents:
            with self.subTest(agent=name):
                self.assertTrue((AGENTS_DIR / f"{name}.md").exists())

        expected_rules = ["harness.md", "orchestration.md"]
        for rule in expected_rules:
            with self.subTest(rule=rule):
                self.assertTrue((RULES_DIR / rule).exists())

    def test_primary_modes_are_peers_and_subagent_false(self) -> None:
        primary_names = ["bulldozer", "piledriver", "excavator"]
        for name in primary_names:
            with self.subTest(primary=name):
                fm, body = load_agent(name)
                self.assertFalse(fm.get("subagent", False), f"{name} must have subagent: false")
                self.assertIn("peer", body.lower())

    def test_specialists_are_subagent_true(self) -> None:
        specialist_names = ["bobcat", "puma", "jaguar", "steamroller", "strix-halo", "zen"]
        for name in specialist_names:
            with self.subTest(specialist=name):
                fm, _ = load_agent(name)
                self.assertTrue(fm.get("subagent", False), f"{name} must have subagent: true")

    def test_model_tiers(self) -> None:
        tier_map = {
            "bulldozer": "inherit",
            "piledriver": "pro",
            "excavator": "pro",
            "bobcat": "flash",
            "puma": "flash",
            "jaguar": "flash",
            "steamroller": "pro",
            "strix-halo": "pro",
            "zen": "pro",
        }
        for name, expected_tier in tier_map.items():
            with self.subTest(agent=name):
                fm, _ = load_agent(name)
                self.assertEqual(fm.get("model"), expected_tier)

    def test_mutation_tool_boundaries(self) -> None:
        mutation_tools = {"write_to_file", "replace_file_content"}

        # Roles permitted to mutate code: excavator, bobcat, puma
        allowed_mutators = ["excavator", "bobcat", "puma"]
        for name in allowed_mutators:
            with self.subTest(mutator=name):
                fm, _ = load_agent(name)
                tools = set(fm.get("tools", []))
                self.assertTrue(mutation_tools.issubset(tools), f"{name} must have mutation tools")

        # Non-mutating roles: bulldozer, piledriver, jaguar, steamroller, strix-halo, zen
        non_mutators = ["bulldozer", "piledriver", "jaguar", "steamroller", "strix-halo", "zen"]
        for name in non_mutators:
            with self.subTest(non_mutator=name):
                fm, _ = load_agent(name)
                tools = set(fm.get("tools", []))
                self.assertTrue(tools.isdisjoint(mutation_tools), f"{name} must NOT have mutation tools")

    def test_delegation_capabilities(self) -> None:
        # Roles with invoke_subagent
        delegators = ["bulldozer", "piledriver", "excavator", "bobcat"]
        for name in delegators:
            with self.subTest(delegator=name):
                fm, _ = load_agent(name)
                self.assertIn("invoke_subagent", fm.get("tools", []))

        # Leaf roles that must NEVER delegate
        leaves = ["puma", "jaguar", "steamroller", "strix-halo", "zen"]
        for name in leaves:
            with self.subTest(leaf=name):
                fm, body = load_agent(name)
                self.assertNotIn("invoke_subagent", fm.get("tools", []))
                self.assertTrue(
                    "zero delegation" in body.lower() or "never delegates" in body.lower() or "no subagents" in body.lower(),
                    f"{name} must document no subagents/zero delegation"
                )

    def test_child_delegation_graphs(self) -> None:
        # Bulldozer allowed children: bobcat, puma, jaguar, steamroller, zen; forbidden: piledriver, excavator
        _, bz_body = load_agent("bulldozer")
        for child in ["bobcat", "puma", "jaguar", "steamroller", "zen"]:
            self.assertIn(child, bz_body.lower())
        self.assertIn("piledriver", bz_body.lower())
        self.assertIn("excavator", bz_body.lower())

        # Piledriver allowed children: jaguar, zen; forbidden: bobcat, puma, steamroller, excavator
        _, pd_body = load_agent("piledriver")
        self.assertIn("jaguar", pd_body.lower())
        self.assertIn("zen", pd_body.lower())
        for forbidden in ["bobcat", "puma", "steamroller", "excavator"]:
            self.assertIn(forbidden, pd_body.lower())

        # Bobcat allowed child: strix-halo only
        _, bc_body = load_agent("bobcat")
        self.assertIn("strix-halo", bc_body.lower())

    def test_shell_marker_boundaries(self) -> None:
        _, exc_body = load_agent("excavator")
        self.assertIn("NTG_EXCAVATOR=1 ", exc_body)

        _, zen_body = load_agent("zen")
        self.assertIn("NTG_ZEN_VERIFY=1 ", zen_body)

    def test_gates_and_readiness_semantics(self) -> None:
        # Bobcat advisor gate
        _, bz_body = load_agent("bulldozer")
        self.assertIn("ADVISOR_GATE: REQUIRED", bz_body)
        self.assertIn("ADVISOR_GATE: NONE", bz_body)

        _, bc_body = load_agent("bobcat")
        self.assertIn("ADVISOR_GATE: REQUIRED", bc_body)
        self.assertIn("VERDICT: ACCEPT", bc_body)
        self.assertIn("VERDICT: REVISE", bc_body)

        # Piledriver Zen gate
        _, pd_body = load_agent("piledriver")
        self.assertIn("PLAN READY", pd_body)
        self.assertIn("VERDICT: GO", pd_body)

        # Excavator PR #15 Zen completion gate
        _, exc_body = load_agent("excavator")
        self.assertIn("VERDICT: GO", exc_body)
        self.assertIn("READY", exc_body)


if __name__ == "__main__":
    unittest.main()
