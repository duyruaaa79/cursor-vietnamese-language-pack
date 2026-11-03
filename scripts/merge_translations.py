#!/usr/bin/env python3
"""Merge translated chunk files into a dictionary, dropping entries that fail validation.

Usage: python3 scripts/merge_translations.py [--target i18n/cursor-ui.json] tmp/out/*.json
Default target is i18n/vi.json.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate_vi import problems  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    args = sys.argv[1:]
    target = ROOT / "i18n" / "vi.json"
    if args[:1] == ["--target"]:
        target = ROOT / args[1]
        args = args[2:]
    merged: dict[str, str] = {}
    if target.exists():
        merged.update(json.loads(target.read_text(encoding="utf-8")))
    added = rejected = 0
    for path in args:
        try:
            data = json.loads(Path(path).read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            print(f"skip {path}: invalid JSON ({e})")
            continue
        for en, vi in data.items():
            if problems(en, vi):
                rejected += 1
                continue
            merged[en] = vi
            added += 1
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(dict(sorted(merged.items())), ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(f"merged {added}, rejected {rejected}, total {len(merged)} -> {target.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
