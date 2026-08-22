import argparse
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def read_json(path, fallback):
    if not path.exists():
        return fallback
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return fallback
    return json.loads(text)


def write_json(path, data):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=str(ROOT / "data" / "gas-users.json"))
    parser.add_argument("--target-db", default=r"D:\dlrs-personas\data\db.json")
    args = parser.parse_args()

    source_path = Path(args.source)
    target_path = Path(args.target_db)
    users = read_json(source_path, [])
    db = read_json(target_path, {})
    db.setdefault("gasUsers", [])

    merged = {str(item.get("uid")): item for item in db["gasUsers"] if isinstance(item, dict) and item.get("uid") is not None}
    added = 0
    updated = 0
    for item in users:
        if not isinstance(item, dict) or item.get("uid") is None:
            continue
        uid = str(item["uid"])
        if uid in merged:
            updated += 1
        else:
            added += 1
        merged[uid] = item

    db["gasUsers"] = sorted(merged.values(), key=lambda item: int(item.get("uid", 0)))
    write_json(target_path, db)
    print(f"Import done: added {added}, updated {updated}, cached GAS users {len(db['gasUsers'])}")


if __name__ == "__main__":
    main()
