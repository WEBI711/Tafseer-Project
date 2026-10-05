"""Losslessness check: every non-empty paragraph line of every docx must
appear in the parser's output. Skips files the parser dropped on purpose
(duplicate surah copies recorded in juz.extras). Writes the missing lines to
/tmp/missing-lines.txt for triage.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document

from .structured import find_juz_folders, parse_juz, docx_files, clean, _body_items


def strings_of(node, out):
    if isinstance(node, dict):
        for v in node.values():
            strings_of(v, out)
    elif isinstance(node, list):
        for x in node:
            strings_of(x, out)
    elif isinstance(node, str):
        out.add(re.sub(r"\s+", " ", node).strip())


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def main():
    folders = dict(find_juz_folders())
    out_path = Path("/tmp/missing-lines.txt")
    total = 0
    with out_path.open("w", encoding="utf-8") as report:
        for n, folder in sorted(folders.items()):
            inst = parse_juz(n, folder, None, None)
            hay = set()
            strings_of(inst, hay)
            for p in inst["parts"]:
                for s in p["sections"]:
                    for u in s["ayah_units"]:
                        t = u["translation"]
                        if t:
                            hay.add(norm(f"({t['ref']}) {t['text']}"))
            dropped = {e["text"].split(" (surah")[0]
                       for e in inst["juz"]["extras"]
                       if e.get("kind") in ("duplicate_surah_content",
                                            "cp_duplicate_content")}
            miss = []
            for f in docx_files(folder):
                if f.name in dropped:
                    continue
                for p in _body_items(Document(str(f))):
                    if not hasattr(p, "text"):
                        continue
                    t = clean(p.text)
                    if not t:
                        continue
                    for line in t.split("\n"):
                        line = norm(line)
                        if not line:
                            continue
                        if line in hay or any((line in h or h in line) and min(len(h), len(line)) > 2 for h in hay):
                            continue
                        miss.append(f"{f.name}: {line}")
            total += len(miss)
            print(f"juz {n:02d}: {len(miss)}")
            for m in miss:
                report.write(m + "\n")
    print(f"TOTAL: {total}  (full list: {out_path})")


if __name__ == "__main__":
    main()
