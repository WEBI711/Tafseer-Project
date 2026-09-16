import sys

from .parse import dump, parse_directory

if __name__ == "__main__":
    data_dir = sys.argv[1] if len(sys.argv) > 1 else "../data"
    docs = parse_directory(data_dir)
    dump(docs, __import__("pathlib").Path("parsed.json"))
    for d in docs:
        for s in d["surahs"]:
            ayahs = sum(len(sec["ayahs"]) for sec in s["sections"])
            print(
                f"{d['source_file']} | juz={d['juz']} | surah {s['number']} "
                f"{s['name_en']} | sections={len(s['sections'])} ayahs={ayahs}"
            )