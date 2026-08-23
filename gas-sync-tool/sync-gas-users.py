import argparse
import base64
import json
import os
import random
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "db.json"
USERS_EXPORT_PATH = ROOT / "data" / "gas-users.json"
STATE_PATH = ROOT / "data" / "gas-sync-state.json"
FAIL_PATH = ROOT / "data" / "gas-sync-failed.txt"


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat()


def read_json(path):
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return None
    return json.loads(text)


def write_json(path, data, indent=2):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=indent), encoding="utf-8")
    os.replace(tmp, path)


class FetchError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class PowerShellFetcher:
    def __init__(self):
        self.proc = None

    def start(self):
        if self.proc is not None:
            return
        script = r'''
$ErrorActionPreference = "Stop"
$headers = @{
  "User-Agent" = "Mozilla/5.0"
  "Accept" = "application/json,text/plain,*/*"
  "Origin" = "https://chinadlrs.com"
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line -eq "__EXIT__") { break }
  $uid = [int]$line
  try {
    $headers["Referer"] = ("https://chinadlrs.com/space/{0}" -f $uid)
    $uri = ("https://api.chinadlrs.com/v1/user/get-space.php?uid={0}" -f $uid)
    $resp = Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $uri -TimeoutSec 15
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($resp.Content)
    $encoded = [Convert]::ToBase64String($bytes)
    [Console]::Out.WriteLine(("OK|{0}" -f $encoded))
  } catch {
    $status = 0
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
    } elseif ($_.Exception.Message -match "\((\d{3})\)") {
      $status = [int]$Matches[1]
    }
    $msg = $_.Exception.Message.Replace("|", "/").Replace("`r", " ").Replace("`n", " ")
    [Console]::Out.WriteLine(("ERR|{0}|{1}" -f $status, $msg))
  }
}
'''
        self.proc = subprocess.Popen(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

    def fetch(self, uid):
        self.start()
        assert self.proc is not None and self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(f"{uid}\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline().strip()
        if line.startswith("OK|"):
            return base64.b64decode(line[3:]).decode("utf-8", errors="replace")
        if line.startswith("ERR|"):
            parts = line.split("|", 2)
            status = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
            message = parts[2] if len(parts) > 2 else line
            if not status:
                match = re.search(r"\((\d{3})\)", message)
                status = int(match.group(1)) if match else 0
            raise FetchError(status, message)
        raise FetchError(0, line)

    def close(self):
        if self.proc and self.proc.stdin:
            try:
                self.proc.stdin.write("__EXIT__\n")
                self.proc.stdin.flush()
            except Exception:
                pass
        self.proc = None


def read_db():
    db = read_json(DB_PATH)
    if not isinstance(db, dict):
        db = {}
    db.setdefault("gasUsers", [])
    return db


def write_state(current_uid, next_uid, checked, found, start_uid, end_uid, total, cached, status, message=""):
    write_json(STATE_PATH, {
        "currentUid": current_uid,
        "nextUid": next_uid,
        "startUid": start_uid,
        "endUid": end_uid,
        "checked": checked,
        "total": total,
        "cached": cached,
        "foundThisRun": found,
        "status": status,
        "message": message,
        "updatedAt": now_iso(),
    })


def save_db(db, merged):
    db["gasUsers"] = sorted(merged.values(), key=lambda item: int(item.get("uid", 0)))
    write_json(DB_PATH, db)
    write_json(USERS_EXPORT_PATH, db["gasUsers"])


def user_from_payload(uid, payload):
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


def fetch_user(fetcher, uid, retries):
    for attempt in range(retries + 1):
        try:
            return user_from_payload(uid, json.loads(fetcher.fetch(uid)))
        except FetchError as error:
            if error.status == 404:
                return "NOT_FOUND"
            if error.status == 468:
                raise
            if attempt >= retries:
                FAIL_PATH.parent.mkdir(parents=True, exist_ok=True)
                with FAIL_PATH.open("a", encoding="utf-8") as f:
                    f.write(f"{uid}\n")
                return None
            time.sleep(0.5 + attempt * 0.8)
        except Exception:
            if attempt >= retries:
                FAIL_PATH.parent.mkdir(parents=True, exist_ok=True)
                with FAIL_PATH.open("a", encoding="utf-8") as f:
                    f.write(f"{uid}\n")
                return None
            time.sleep(0.5 + attempt * 0.8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--end", type=int, default=80000)
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--save-every", type=int, default=20)
    parser.add_argument("--status-every", type=int, default=1)
    parser.add_argument("--delay-ms", type=int, default=700)
    parser.add_argument("--jitter-ms", type=int, default=0)
    parser.add_argument("--max-checks", type=int, default=0)
    parser.add_argument("--block-wait-minutes", type=int, default=5)
    parser.add_argument("--skip-cached", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--stop-on-block", action="store_true")
    args = parser.parse_args()

    if args.start < 1 or args.end < args.start:
        raise SystemExit("Usage: python sync-gas-users.py --start 1 --end 80000")

    start_uid = args.start
    if args.resume and STATE_PATH.exists():
        try:
            state = read_json(STATE_PATH) or {}
            next_uid = int(state.get("nextUid") or 0)
            if start_uid < next_uid <= args.end:
                start_uid = next_uid
                print(f"Resume from UID {start_uid}", flush=True)
        except Exception:
            pass

    db = read_db()
    merged = {str(item["uid"]): item for item in db.get("gasUsers", []) if isinstance(item, dict) and item.get("uid") is not None}

    total_range = args.end - start_uid + 1
    total = min(total_range, args.max_checks) if args.max_checks > 0 else total_range
    checked = 0
    found = 0
    fetcher = PowerShellFetcher()

    write_state(start_uid - 1, start_uid, 0, 0, start_uid, args.end, total, len(merged), "running")
    print(f"GAS sync running: {start_uid} -> {args.end}", flush=True)
    print(f"Speed: {args.delay_ms / 1000:.1f}s/request", flush=True)
    print(f"404: skip, 468: wait {args.block_wait_minutes} minutes and retry same UID", flush=True)
    print(f"Cached users: {len(merged)}", flush=True)
    print(f"State file: {STATE_PATH}", flush=True)

    try:
        for uid in range(start_uid, args.end + 1):
            if args.max_checks > 0 and checked >= args.max_checks:
                write_state(uid - 1, uid, checked, found, start_uid, args.end, total, len(merged), "paused", "max-checks reached")
                print(f"Paused after {checked} checks. Next UID: {uid}", flush=True)
                break

            if args.skip_cached and str(uid) in merged:
                checked += 1
                write_state(uid, uid + 1, checked, found, start_uid, args.end, total, len(merged), "running", "cached skipped")
                continue

            while True:
                try:
                    user = fetch_user(fetcher, uid, args.retries)
                    break
                except FetchError as error:
                    if error.status == 468:
                        save_db(db, merged)
                        wait_seconds = max(1, args.block_wait_minutes) * 60
                        write_state(uid, uid, checked, found, start_uid, args.end, total, len(merged), "blocked", error.message)
                        print(f"HTTP 468 at UID {uid}. Sleep {wait_seconds}s, then retry same UID.", flush=True)
                        fetcher.close()
                        time.sleep(wait_seconds)
                        fetcher = PowerShellFetcher()
                        continue
                    raise

            checked += 1

            if user == "NOT_FOUND":
                print(f"404 UID {uid} skipped", flush=True)
            elif user:
                merged[user["uid"]] = user
                found += 1
                save_db(db, merged)
                print(f"FOUND UID {user['uid']}: {user['nickname']}", flush=True)

            write_state(uid, uid + 1, checked, found, start_uid, args.end, total, len(merged), "running")

            if checked % max(1, args.status_every) == 0:
                percent = round((checked * 100.0) / total, 2) if total else 100
                print(f"Progress: checked {checked}/{total} ({percent}%), current UID {uid}, cached {len(merged)}, found {found}", flush=True)

            if checked % max(1, args.save_every) == 0:
                save_db(db, merged)

            sleep_ms = args.delay_ms + (random.randint(0, args.jitter_ms) if args.jitter_ms > 0 else 0)
            if sleep_ms > 0:
                time.sleep(sleep_ms / 1000.0)
        else:
            save_db(db, merged)
            write_state(args.end, args.end + 1, checked, found, start_uid, args.end, total, len(merged), "done")
            print(f"GAS sync done: checked {checked}, cached {len(merged)}, found {found}", flush=True)
            return

        save_db(db, merged)
        print(f"GAS sync stopped: checked {checked}, cached {len(merged)}, found {found}", flush=True)
    finally:
        fetcher.close()


if __name__ == "__main__":
    main()
