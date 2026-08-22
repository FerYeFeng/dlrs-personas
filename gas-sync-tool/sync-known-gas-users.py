import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOCAL_DB_PATH = ROOT / "data" / "db.json"
EXPORT_PATH = ROOT / "data" / "gas-users.json"
STATE_PATH = ROOT / "data" / "gas-sync-state.json"
UIDS_PATH = ROOT / "gas-uids.txt"


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat()


def read_json(path, fallback):
    if not path.exists():
        return fallback
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return fallback
    return json.loads(text)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def collect_uids(site_db_path):
    uids = set()

    local_db = read_json(LOCAL_DB_PATH, {})
    site_db = read_json(Path(site_db_path), {}) if site_db_path else {}
    for db in (local_db, site_db):
        for person in db.get("people", []) or []:
            gas = ((person.get("accounts") or {}).get("gas") or "").strip()
            if gas.isdigit():
                uids.add(gas)
        for item in db.get("gasUsers", []) or []:
            uid = str(item.get("uid") or "").strip()
            if uid.isdigit():
                uids.add(uid)

    if UIDS_PATH.exists():
        for line in UIDS_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and line.isdigit():
                uids.add(line)

    return sorted(uids, key=int)


def fetch_uid(uid, timeout):
    url = f"https://api.chinadlrs.com/v1/user/get-space.php?uid={uid}"
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json,text/plain,*/*",
        "Origin": "https://chinadlrs.com",
        "Referer": f"https://chinadlrs.com/space/{uid}",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8", errors="replace"))
    data = payload.get("data") or {}
    nickname = str(data.get("nickname") or "").strip()
    if payload.get("code") != 200 or not nickname:
        return None
    return {
        "uid": str(uid),
        "nickname": nickname,
        "avatar": str(data.get("avatar") or ""),
        "vType": data.get("v_type"),
        "vInfo": str(data.get("v_info") or ""),
        "url": f"https://chinadlrs.com/space/{uid}",
        "updatedAt": now_iso(),
    }


def write_state(current_uid, checked, total, cached, found, status):
    write_json(STATE_PATH, {
        "currentUid": current_uid,
        "checked": checked,
        "total": total,
        "cached": cached,
        "foundThisRun": found,
        "status": status,
        "updatedAt": now_iso(),
    })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-db", default=r"D:\dlrs-personas\data\db.json")
    parser.add_argument("--delay-ms", type=int, default=1500)
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--skip-cached", action="store_true")
    args = parser.parse_args()

    db = read_json(LOCAL_DB_PATH, {})
    db.setdefault("gasUsers", [])
    merged = {str(item.get("uid")): item for item in db["gasUsers"] if isinstance(item, dict) and item.get("uid") is not None}
    uids = collect_uids(args.site_db)
    total = len(uids)
    found = 0

    print(f"Low-request GAS sync. UID count: {total}")
    print(f"Extra UID file: {UIDS_PATH}")
    print(f"State file: {STATE_PATH}")

    write_state("", 0, total, len(merged), 0, "running")
    for index, uid in enumerate(uids, start=1):
        if args.skip_cached and uid in merged:
            print(f"Skip cached UID {uid} ({index}/{total})", flush=True)
            write_state(uid, index, total, len(merged), found, "running")
            continue

        try:
            user = fetch_uid(uid, args.timeout)
            if user:
                merged[uid] = user
                found += 1
                print(f"OK UID {uid}: {user['nickname']} ({index}/{total})", flush=True)
            else:
                print(f"MISS UID {uid} ({index}/{total})", flush=True)
        except urllib.error.HTTPError as e:
            print(f"HTTP {e.code} UID {uid}. Stop now to avoid WAF blocking.", flush=True)
            write_state(uid, index, total, len(merged), found, "blocked")
            break
        except Exception as e:
            print(f"ERR UID {uid}: {e}", flush=True)

        db["gasUsers"] = sorted(merged.values(), key=lambda item: int(item.get("uid", 0)))
        write_json(LOCAL_DB_PATH, db)
        write_json(EXPORT_PATH, db["gasUsers"])
        write_state(uid, index, total, len(merged), found, "running")

        if args.delay_ms > 0 and index < total:
            time.sleep(args.delay_ms / 1000)
    else:
        write_state(uids[-1] if uids else "", total, total, len(merged), found, "done")

    print(f"Done. Cached: {len(merged)}, found this run: {found}")


if __name__ == "__main__":
    main()
