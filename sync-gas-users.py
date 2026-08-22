import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "db.json"
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
    $resp = Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri ("https://api.chinadlrs.com/v1/user/get-space.php?uid={0}" -f $uid) -TimeoutSec 15
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($resp.Content)
    $encoded = [Convert]::ToBase64String($bytes)
    [Console]::Out.WriteLine(("OK|{0}" -f $encoded))
  } catch {
    $msg = $_.Exception.Message.Replace("|", "/").Replace("`r", " ").Replace("`n", " ")
    [Console]::Out.WriteLine(("ERR|{0}" -f $msg))
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
        if not line.startswith("OK|"):
            raise RuntimeError(line[4:] if line.startswith("ERR|") else line)
        raw = line[3:]
        return __import__("base64").b64decode(raw).decode("utf-8", errors="replace")

    def close(self):
        if self.proc and self.proc.stdin:
            try:
                self.proc.stdin.write("__EXIT__\n")
                self.proc.stdin.flush()
            except Exception:
                pass


def read_db():
    db = read_json(DB_PATH)
    if not isinstance(db, dict):
        db = {}
    db.setdefault("gasUsers", [])
    return db


def write_state(current_uid, next_uid, checked, found, start_uid, end_uid, total, cached, status):
    state = {
        "currentUid": current_uid,
        "nextUid": next_uid,
        "startUid": start_uid,
        "endUid": end_uid,
        "checked": checked,
        "total": total,
        "cached": cached,
        "foundThisRun": found,
        "status": status,
        "updatedAt": now_iso(),
    }
    write_json(STATE_PATH, state, indent=2)


def save_db(db, merged):
    db["gasUsers"] = sorted(merged.values(), key=lambda item: int(item.get("uid", 0)))
    write_json(DB_PATH, db, indent=2)


FETCHER = PowerShellFetcher()


def fetch_user(uid, retries):
    for attempt in range(retries + 1):
        try:
            payload = json.loads(FETCHER.fetch(uid))
            data = payload.get("data") or {}
            nickname = str(data.get("nickname") or "").strip()
            if payload.get("code") == 200 and nickname:
                return {
                    "uid": str(uid),
                    "nickname": nickname,
                    "avatar": str(data.get("avatar") or ""),
                    "vType": data.get("v_type"),
                    "vInfo": str(data.get("v_info") or ""),
                    "url": f"https://chinadlrs.com/space/{uid}",
                    "updatedAt": now_iso(),
                }
            return None
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
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--save-every", type=int, default=100)
    parser.add_argument("--status-every", type=int, default=1)
    parser.add_argument("--delay-ms", type=int, default=120)
    parser.add_argument("--resume", action="store_true")
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
                print(f"继续同步，从 UID {start_uid} 开始", flush=True)
        except Exception:
            pass

    db = read_db()
    merged = {str(item["uid"]): item for item in db.get("gasUsers", []) if isinstance(item, dict) and item.get("uid") is not None}

    total = args.end - start_uid + 1
    checked = 0
    found = 0

    write_state(start_uid - 1, start_uid, 0, 0, start_uid, args.end, total, len(merged), "running")
    print(f"GAS 用户同步开始：{start_uid} -> {args.end}", flush=True)
    print(f"当前已缓存：{len(merged)}", flush=True)
    print(f"状态文件：{STATE_PATH}", flush=True)

    for uid in range(start_uid, args.end + 1):
        user = fetch_user(uid, args.retries)
        checked += 1

        if user:
            merged[user["uid"]] = user
            found += 1
            save_db(db, merged)
            print(f"FOUND UID {user['uid']}: {user['nickname']}", flush=True)

        write_state(uid, uid + 1, checked, found, start_uid, args.end, total, len(merged), "running")

        if checked % max(1, args.status_every) == 0:
            percent = round((checked * 100.0) / total, 2)
            print(
                f"进度：已检查 {checked}/{total} ({percent}%)，当前 UID {uid}，已缓存 {len(merged)}，本次找到 {found}",
                flush=True,
            )

        if checked % max(1, args.save_every) == 0:
            save_db(db, merged)

        if args.delay_ms > 0:
            time.sleep(args.delay_ms / 1000.0)

    save_db(db, merged)
    write_state(args.end, args.end + 1, checked, found, start_uid, args.end, total, len(merged), "done")
    print(f"GAS 用户同步完成：已检查 {checked}，已缓存 {len(merged)}，本次找到 {found}", flush=True)
    FETCHER.close()


if __name__ == "__main__":
    main()
