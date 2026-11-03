#!/usr/bin/env python3
"""Merge translated chunk files into i18n/vi.json, dropping entries that fail validation.

Usage: python3 scripts/merge_translations.py tmp/out/*.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate_vi import problems  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "i18n" / "vi.json"


def main() -> int:
    merged: dict[str, str] = {}
    if TARGET.exists():
        merged.update(json.loads(TARGET.read_text(encoding="utf-8")))
    added = rejected = 0
    for path in sys.argv[1:]:
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
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(
        json.dumps(dict(sorted(merged.items())), ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
    )
    print(f"merged {added}, rejected {rejected}, total {len(merged)} -> {TARGET.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
