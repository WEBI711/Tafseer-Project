"""Diff structured.py output against the hand-audited sample JSONs.

The samples are ground truth. This reports, per juz: part count, section
count, ayah-unit count, captured-ref set differences, and coverage verdict.
"""
import json
import sys
from pathlib import Path

from .structured import parse_juz, find_juz_folders, docx_files, parse_cp

SAMPLES = Path(__file__).resolve().parents[1] / "spec" / "samples"


def captured_refs(inst: dict) -> dict[int, set[int]]:
    refs: dict[int, set[int]] = {}
    for part in inst["parts"]:
        for sec in part["sections"]:
            for u in sec["ayah_units"]:
                t = u.get("translation")
                if not t:
                    continue
                s = t.get("ref_surah") or part["surah_number"]
                a, b = t["from_ayah"], t["to_ayah"]
                if a is None:
                    continue
                for x in range(a, (b or a) + 1):
                    refs.setdefault(s, set()).add(x)
    return refs


def sample_refs(sample: dict) -> dict[int, set[int]]:
    refs: dict[int, set[int]] = {}
    for part in sample["parts"]:
        for sec in part["sections"]:
            for u in sec.get("ayah_units", []):
                t = u.get("translation")
                if not t:
                    continue
                s = t.get("ref_surah") or part["surah_number"]
                a, b = t.get("from_ayah"), t.get("to_ayah")
                if a is None:
                    m = __import__("re").findall(r"\d+", t.get("ref") or "")
                    if len(m) >= 2:
                        s, a, b = int(m[0]), int(m[1]), int(m[-1])
                    elif len(m) == 1:
                        a = b = int(m[0])
                    else:
                        continue
                for x in range(a, (b or a) + 1):
                    refs.setdefault(s, set()).add(x)
    return refs


def main(only: int | None = None):
    folders = dict(find_juz_folders())
    numbers = [only] if only else sorted(folders)
    for n in numbers:
        sample_path = SAMPLES / f"juz-{n:02d}.json"
        if not sample_path.exists():
            print(f"juz {n}: no sample")
            continue
        sample = json.loads(sample_path.read_text())
        inst = parse_juz(n, folders[n], None, None)
        sp, ip = sample["parts"], inst["parts"]
        s_secs = sum(len(p["sections"]) for p in sp)
        i_secs = sum(len(p["sections"]) for p in ip)
        s_units = sum(len(s.get("ayah_units", [])) for p in sp for s in p["sections"])
        i_units = sum(len(s["ayah_units"]) for p in ip for s in p["sections"])
        srefs, irefs = sample_refs(sample), captured_refs(inst)
        extra = {s: sorted(irefs.get(s, set()) - srefs.get(s, set())) for s in set(irefs) | set(srefs)
                 if irefs.get(s, set()) - srefs.get(s, set())}
        missing = {s: sorted(srefs.get(s, set()) - irefs.get(s, set())) for s in set(irefs) | set(srefs)
                   if srefs.get(s, set()) - irefs.get(s, set())}
        print(f"juz {n:02d}: parts {len(sp)}/{len(ip)} sections {s_secs}/{i_secs} "
              f"units {s_units}/{i_units} cov {(sample.get('coverage_check') or {}).get('result', '?')}/{inst['coverage_check']['result']}")
        if extra:
            print(f"   parser-only refs: {extra}")
        if missing:
            print(f"   sample-only refs: {missing}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else None)
