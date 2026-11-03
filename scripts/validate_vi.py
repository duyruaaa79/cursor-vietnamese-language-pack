#!/usr/bin/env python3
"""Check that Vietnamese translations keep every placeholder from the English source.

Usage: python3 scripts/validate_vi.py FILE.json [FILE.json ...]
Each file is a JSON object {english: vietnamese}.
"""

from __future__ import annotations

import json
import re
import sys
from collections import Counter

TOKEN = re.compile(
    r"\{\d+\}|\{[\w.:-]+\}|\$\{[^}]+\}|\$\d+|`[^`]+`|\]\([^)]+\)|https?://[^\s)]+|<[^>]+>|%[sd]"
)


def problems(en: str, vi: str) -> list[str]:
    out = []
    if not isinstance(vi, str) or not vi.strip():
        return ["empty translation"]
    missing = Counter(TOKEN.findall(en)) - Counter(TOKEN.findall(vi))
    if missing:
        out.append("missing " + ", ".join(sorted(missing)))
    if ("&&" in en) != ("&&" in vi):
        out.append("&& mnemonic mismatch")
    if en.endswith("...") and not vi.endswith("..."):
        out.append("lost trailing ...")
    return out


def main() -> int:
    bad = 0
    total = 0
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for en, vi in data.items():
            total += 1
            p = problems(en, vi)
            if p:
                bad += 1
                print(f"{path}: {en!r} -> {vi!r}: {'; '.join(p)}")
    print(f"{total} entries, {bad} with problems")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
