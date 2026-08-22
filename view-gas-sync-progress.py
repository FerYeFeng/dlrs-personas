import json
import time
from pathlib import Path


STATE_PATH = Path(__file__).resolve().parent / "data" / "gas-sync-state.json"


def load_state():
    if not STATE_PATH.exists():
        return None
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None


def main():
    print("按 Ctrl+C 退出")
    try:
        while True:
            state = load_state()
            print("\033[2J\033[H", end="")
            if state:
                print(f"状态: {state.get('status')}")
                print(f"当前 UID: {state.get('currentUid')} / {state.get('endUid')}")
                print(f"下次 UID: {state.get('nextUid')}")
                print(f"已检查: {state.get('checked')} / {state.get('total')}")
                print(f"已缓存: {state.get('cached')}")
                print(f"本次找到: {state.get('foundThisRun')}")
                print(f"更新时间: {state.get('updatedAt')}")
            else:
                print("还没有进度文件，先运行同步脚本。")
            time.sleep(1)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
