#!/usr/bin/env python3
"""Hard-stop direct mutation from Gemini 3.1 Pro in Native Gravity v0.3.3.

Current v0.3.3 policy maps Gemini 3.1 Pro only to coordination/read-only
roles (experimental Host fallback, Advisor, Deep, Reviewer). Worker remains
Gemini 3.7 Flash. This hook therefore treats a 3.1 Pro mutation attempt as a
policy violation and directs the model back to Worker delegation.

The guard is deliberately narrow:
- non-Gemini models: allow
- Gemini models other than 3.1 Pro: allow
- Gemini 3.1 Pro mutation tools matched by hooks.json: deny

It is not a complete capability sandbox; shell-mediated mutation is outside
this first enforcement slice.
"""

from __future__ import annotations

import json
import sys
from typing import Any


def _allow() -> dict[str, str]:
    return {"decision": "allow"}


def _deny() -> dict[str, str]:
    return {
        "decision": "deny",
        "reason": (
            "Native Gravity v0.3.3 forbids direct project mutation from Gemini 3.1 Pro. "
            "If you are the Host, route ordinary implementation to gravity-worker. "
            "Advisor, Deep, and Reviewer are read-only. Inspect, coordinate, or verify, "
            "but do not edit project files directly."
        ),
    }


def _is_gemini_31_pro(model_name: Any) -> bool:
    if not isinstance(model_name, str):
        return False

    normalized = model_name.strip().lower().replace("_", "-")
    return "gemini" in normalized and "3.1" in normalized and "pro" in normalized


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        print(json.dumps(_allow()))
        return 0

    if _is_gemini_31_pro(payload.get("modelName")):
        print(json.dumps(_deny()))
    else:
        print(json.dumps(_allow()))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
