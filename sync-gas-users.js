const fs = require("fs");
const path = require("path");

const root = __dirname;
const dbPath = path.join(root, "data", "db.json");
const startUid = Number(process.argv[2] || process.env.GAS_SYNC_START || 1);
const endUid = Number(process.argv[3] || process.env.GAS_SYNC_END || 12000);
const concurrency = Math.max(1, Math.min(16, Number(process.env.GAS_SYNC_CONCURRENCY || 8)));
const retries = Math.max(0, Math.min(5, Number(process.env.GAS_SYNC_RETRIES || 2)));

function readDb() {
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  db.gasUsers ||= [];
  return db;
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function gasUserFromPayload(uid, payload) {
  const data = payload?.data || {};
  const nickname = String(data.nickname || data.name || "").trim();
  if (!nickname) return null;
  return {
    uid: String(uid),
    nickname,
    avatar: String(data.avatar || "").trim(),
    vType: data.v_type || 0,
    vInfo: data.v_info || "",
    url: `https://chinadlrs.com/space/${encodeURIComponent(String(uid))}`,
    updatedAt: new Date().toISOString()
  };
}

async function fetchGasUser(uid) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://api.chinadlrs.com/v1/user/get-space.php?uid=${uid}`, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 DLRS-Personas/1.0",
          "Accept": "application/json,text/plain,*/*",
          "Origin": "https://chinadlrs.com",
          "Referer": `https://chinadlrs.com/space/${uid}`
        }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json().catch(() => null);
      return payload?.code === 200 ? gasUserFromPayload(uid, payload) : null;
    } catch (error) {
      if (attempt >= retries) return null;
      await new Promise((resolve) => setTimeout(resolve, 200 + attempt * 300));
    } finally {
      clearTimeout(timer);
    }
  }
}

async function main() {
  if (!Number.isFinite(startUid) || !Number.isFinite(endUid) || startUid < 1 || endUid < startUid) {
    console.error("Usage: node sync-gas-users.js [startUid] [endUid]");
    process.exit(1);
  }

  const db = readDb();
  const byUid = new Map((db.gasUsers || []).map((user) => [String(user.uid), user]));
  let next = startUid;
  let checked = 0;
  let found = 0;

  async function worker() {
    while (next <= endUid) {
      const uid = next++;
      const user = await fetchGasUser(uid);
      checked++;
      if (user) {
        byUid.set(String(user.uid), { ...byUid.get(String(user.uid)), ...user });
        found++;
      }
      if (checked % 200 === 0) {
        db.gasUsers = [...byUid.values()].sort((a, b) => Number(a.uid) - Number(b.uid));
        writeDb(db);
        console.log(`GAS sync: checked ${checked}/${endUid - startUid + 1}, cached ${db.gasUsers.length}, found this run ${found}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  db.gasUsers = [...byUid.values()].sort((a, b) => Number(a.uid) - Number(b.uid));
  writeDb(db);
  console.log(`GAS sync done: checked ${checked}, cached ${db.gasUsers.length}, found this run ${found}`);
}

main();
