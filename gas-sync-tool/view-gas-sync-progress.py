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
    print("Press Ctrl+C to quit")
    try:
        while True:
            state = load_state()
            print("\033[2J\033[H", end="")
            if state:
                print(f"Status: {state.get('status')}")
                print(f"Current UID: {state.get('currentUid')} / {state.get('endUid')}")
                print(f"Next UID: {state.get('nextUid')}")
                print(f"Checked: {state.get('checked')} / {state.get('total')}")
                print(f"Cached: {state.get('cached')}")
                print(f"Found this run: {state.get('foundThisRun')}")
                print(f"Updated at: {state.get('updatedAt')}")
            else:
                print("No state file yet. Run the sync script first.")
            time.sleep(1)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
