const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;
const dataDir = path.join(root, "data");
const uploadDir = path.join(root, "uploads");
const dbPath = path.join(dataDir, "db.json");
const port = Number(process.env.PORT || 9000);
const sessionMaxAge = 1000 * 60 * 60 * 24 * 7;
const passwordIterations = 120000;
const gasSeedUsers = [
  { uid: "5194", nickname: "Fer叶枫" }
];

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify({ people: [], incidents: [], users: [], sessions: {}, submissions: [] }, null, 2));
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

function readDb() {
  const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
  db.people ||= [];
  db.incidents ||= [];
  db.users ||= [];
  db.sessions ||= {};
  db.submissions ||= [];
  db.gasUsers ||= [];
  return db;
}

function writeDb(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  if (!user) return null;
  return {
    qq: user.qq,
    username: user.username || "",
    avatar: user.avatar || "",
    role: user.role || "user",
    mustChangePassword: !!user.mustChangePassword,
    createdAt: user.createdAt || ""
  };
}

function publicUserBrief(user) {
  if (!user) return null;
  return {
    qq: user.qq,
    username: user.username || "",
    avatar: user.avatar || "",
    role: user.role || "user"
  };
}

function isAdminRole(user) {
  return user?.role === "admin" || user?.role === "superadmin";
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((item) => {
    const index = item.indexOf("=");
    return [decodeURIComponent(item.slice(0, index).trim()), decodeURIComponent(item.slice(index + 1).trim())];
  }));
}

function passwordHash(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, passwordIterations, 32, "sha256").toString("hex");
}

function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) return false;
  const hashed = passwordHash(password, user.passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(hashed, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function getSessionUser(req, db) {
  const token = parseCookies(req).dlrs_session;
  const session = token ? db.sessions[token] : null;
  if (!session || Date.parse(session.expiresAt) < Date.now()) {
    if (token) delete db.sessions[token];
    return null;
  }
  return db.users.find((user) => user.qq === session.qq) || null;
}

function requireUser(req, res, db) {
  const user = getSessionUser(req, db);
  if (!user) {
    sendJson(res, 401, { error: "请先登录" });
    return null;
  }
  return user;
}

function requireAdmin(req, res, db) {
  const user = requireUser(req, res, db);
  if (!user) return null;
  if (user.mustChangePassword) {
    sendJson(res, 403, { error: "请先修改初始密码" });
    return null;
  }
  if (!isAdminRole(user)) {
    sendJson(res, 403, { error: "需要管理员权限" });
    return null;
  }
  return user;
}

function requireSuperAdmin(req, res, db) {
  const user = requireAdmin(req, res, db);
  if (!user) return null;
  if (user.role !== "superadmin") {
    sendJson(res, 403, { error: "需要超级管理员权限" });
    return null;
  }
  return user;
}

function saveDataUrl(dataUrl, prefix) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) return "";
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return "";
  const extByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const ext = extByMime[match[1]] || ".jpg";
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), Buffer.from(match[2], "base64"));
  return `/uploads/${filename}`;
}

function saveImageBuffer(buffer, mime, prefix) {
  const extByMime = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const ext = extByMime[String(mime || "").split(";")[0].toLowerCase()] || ".jpg";
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), buffer);
  return `/uploads/${filename}`;
}

async function importRemoteImage(src) {
  if (!isValidHttpUrl(src)) return "";
  const parsed = new URL(src);
  const response = await fetch(src, {
    headers: {
      "User-Agent": "Mozilla/5.0 DLRS-Personas/1.0",
      "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "Referer": parsed.origin + "/"
    }
  });
  if (!response.ok) return "";
  const type = response.headers.get("content-type") || "";
  if (!type.toLowerCase().startsWith("image/")) return "";
  const size = Number(response.headers.get("content-length") || 0);
  if (size > 12 * 1024 * 1024) return "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 12 * 1024 * 1024) return "";
  return saveImageBuffer(buffer, type, "evidence");
}

function isValidHttpUrl(value) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateAccounts(accounts = {}) {
  if (accounts.qq && !/^\d+$/.test(String(accounts.qq))) return "QQ 号必须为纯数字";
  if (accounts.bilibili && !isValidHttpUrl(String(accounts.bilibili))) return "Bilibili 必须填写完整链接";
  if (accounts.douyin && !isValidHttpUrl(String(accounts.douyin))) return "抖音必须填写完整链接";
  if (accounts.gas && /[\s/\\?#]/.test(String(accounts.gas))) return "GAS UID 不能包含空格或路径符号";
  return "";
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 DLRS-Personas/1.0",
      "Accept": "application/json,text/plain,*/*",
      ...headers
    }
  });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function gasUserFromSpace(uid, payload) {
  const data = payload?.data || {};
  const nickname = String(data.nickname || data.name || "").trim();
  if (!nickname) return null;
  return {
    uid: String(uid),
    nickname,
    avatar: String(data.avatar || "").trim(),
    vType: data.v_type || 0,
    vInfo: data.v_info || "",
    url: `https://chinadlrs.com/space/${encodeURIComponent(String(uid))}`
  };
}

async function getGasSpace(uid) {
  if (!/^\d+$/.test(String(uid || ""))) return null;
  const payload = await fetchJson(`https://api.chinadlrs.com/v1/user/get-space.php?uid=${encodeURIComponent(String(uid))}`, {
    "Origin": "https://chinadlrs.com",
    "Referer": `https://chinadlrs.com/space/${encodeURIComponent(String(uid))}`
  });
  return payload?.code === 200 ? gasUserFromSpace(uid, payload) : null;
}

function normalizeGasKeyword(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, "");
}

function mergeGasUserCache(db, user) {
  if (!user?.uid) return false;
  db.gasUsers ||= [];
  const index = db.gasUsers.findIndex((item) => String(item.uid) === String(user.uid));
  const next = { ...user, updatedAt: new Date().toISOString() };
  if (index >= 0) {
    db.gasUsers[index] = { ...db.gasUsers[index], ...next };
  } else {
    db.gasUsers.unshift(next);
  }
  return true;
}

function cachedGasMatches(db, keyword) {
  const q = normalizeGasKeyword(keyword);
  const pool = [...(db.gasUsers || []), ...gasSeedUsers];
  const seen = new Set();
  return pool.filter((item) => {
    const uid = String(item.uid || "");
    const nickname = String(item.nickname || "");
    if (!uid || seen.has(uid)) return false;
    const matched = normalizeGasKeyword(uid).includes(q) || normalizeGasKeyword(nickname).includes(q);
    if (matched) seen.add(uid);
    return matched;
  });
}

function decodeDuckDuckGoUrl(value) {
  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    const redirect = parsed.searchParams.get("uddg");
    return redirect ? decodeURIComponent(redirect) : parsed.href;
  } catch {
    return value;
  }
}

async function searchGasUsers(keyword, db) {
  const query = String(keyword || "").trim();
  if (!query) return [];
  const results = [...cachedGasMatches(db, query)];
  const seen = new Set();
  results.forEach((item) => seen.add(String(item.uid)));
  const addUid = async (uid) => {
    if (!/^\d+$/.test(uid) || seen.has(uid) || seen.size >= 12) return;
    seen.add(uid);
    const user = await getGasSpace(uid);
    if (!user) return;
    mergeGasUserCache(db, user);
    if (query === uid || normalizeGasKeyword(user.nickname).includes(normalizeGasKeyword(query))) results.push(user);
  };

  if (/^\d+$/.test(query)) await addUid(query);
  return results.slice(0, 12);
}

function validateDateValue(value) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

async function processIncidentContentHtml(html = "") {
  let output = String(html)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\shref=(["'])javascript:[\s\S]*?\1/gi, "")
    .replace(/<img\b[^>]*\bsrc=(["'])(data:image\/[^"']+)\1[^>]*>/gi, (_tag, _quote, dataUrl) => {
      const src = saveDataUrl(dataUrl, "evidence");
      return src ? `<img src="${src}" alt="事件图片">` : "";
    });
  const remoteMatches = [...output.matchAll(/<img\b[^>]*\bsrc=(["'])(https?:\/\/[^"']+)\1[^>]*>/gi)];
  for (const match of remoteMatches) {
    const local = await importRemoteImage(match[2]).catch(() => "");
    if (local) output = output.replace(match[0], `<img src="${local}" alt="事件图片">`);
  }
  return output;
}

function auditEntry(action, user, before = null) {
  return {
    action,
    by: user?.qq || "",
    at: new Date().toISOString(),
    before
  };
}

function snapshotRecord(record) {
  if (!record) return null;
  return {
    name: record.name,
    title: record.title,
    status: record.status,
    category: record.category,
    date: record.date,
    accounts: record.accounts,
    detail: record.detail,
    contentHtml: record.contentHtml,
    result: record.result
  };
}

function stampCreate(record, user) {
  record.createdBy ||= user?.qq || "";
  record.updatedBy = user?.qq || "";
  record.history = Array.isArray(record.history) ? record.history : [];
  if (!record.history.length) record.history.push(auditEntry("创建", user));
  return record;
}

function stampUpdate(record, existing, user) {
  record.createdBy = existing.createdBy || user?.qq || "";
  record.updatedBy = user?.qq || "";
  record.history = Array.isArray(existing.history) ? [...existing.history] : [];
  record.history.push(auditEntry("修改", user, snapshotRecord(existing)));
  return record;
}

async function normalizePerson(input, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || input.id || crypto.randomUUID(),
    name: input.name || "未命名人物",
    tags: Array.isArray(input.tags) ? input.tags : [],
    bio: input.bio || "",
    bioHtml: await processIncidentContentHtml(input.bioHtml || ""),
    avatar: input.avatarData ? saveDataUrl(input.avatarData, "avatar") : (input.avatar || existing.avatar || ""),
    banner: input.bannerData ? saveDataUrl(input.bannerData, "banner") : (input.banner || existing.banner || ""),
    status: input.status || existing.status || "active",
    credibility: input.credibility || existing.credibility || "unverified",
    accounts: {
      qq: input.accounts?.qq || "",
      bilibili: input.accounts?.bilibili || "",
      douyin: input.accounts?.douyin || "",
      gas: input.accounts?.gas || ""
    },
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
    createdBy: existing.createdBy || input.createdBy || "",
    updatedBy: existing.updatedBy || input.updatedBy || "",
    history: Array.isArray(existing.history) ? existing.history : (Array.isArray(input.history) ? input.history : [])
  };
}

async function normalizeIncident(input, existing = {}) {
  const now = new Date().toISOString();
  const existingPersonIds = Array.isArray(existing.personIds) ? existing.personIds.filter(Boolean) : [];
  const sourcePersonIds = Array.isArray(input.personIds)
    ? input.personIds
    : [input.personId || "", ...existingPersonIds, existing.personId || ""];
  const personIds = [...new Set(sourcePersonIds.filter(Boolean))];
  const newImages = Array.isArray(input.imageData)
    ? input.imageData.map((item) => saveDataUrl(item, "evidence")).filter(Boolean)
    : [];
  const baseImages = Array.isArray(input.images) ? input.images : (existing.images || []);
  return {
    id: existing.id || input.id || crypto.randomUUID(),
    personId: personIds[0] || "",
    personIds,
    title: input.title || "未命名事件",
    date: input.date || existing.date || now.slice(0, 10),
    category: input.category || existing.category || "其他",
    detail: input.detail || "",
    contentHtml: await processIncidentContentHtml(input.contentHtml || ""),
    evidence: input.evidence || "",
    images: [...baseImages, ...newImages],
    result: input.result || "",
    pinned: !!input.pinned,
    recommended: !!input.recommended,
    viewCount: Number.isFinite(Number(input.viewCount ?? existing.viewCount))
      ? Math.max(0, Number(input.viewCount ?? existing.viewCount))
      : 0,
    credibility: input.credibility || existing.credibility || "unverified",
    createdAt: existing.createdAt || input.createdAt || now,
    updatedAt: now,
    createdBy: existing.createdBy || input.createdBy || "",
    updatedBy: existing.updatedBy || input.updatedBy || "",
    history: Array.isArray(existing.history) ? existing.history : (Array.isArray(input.history) ? input.history : [])
  };
}

function newSubmission(type, payload, user) {
  return {
    id: crypto.randomUUID(),
    type,
    payload,
    status: "pending",
    submitterQq: user.qq,
    createdAt: new Date().toISOString()
  };
}

async function approveSubmission(db, submission, admin) {
  if (submission.type === "person") {
    let person = await normalizePerson(submission.payload);
    person = stampCreate(person, { qq: submission.submitterQq });
    person.approvedBy = admin.qq;
    db.people.unshift(person);
    submission.approvedTargetId = person.id;
  }
  if (submission.type === "incident") {
    const payload = { ...submission.payload };
    if (!payload.personId && !(Array.isArray(payload.personIds) && payload.personIds.length)) {
      let person = await normalizePerson({ name: "未归档人物", status: "controversial" });
      person = stampCreate(person, { qq: submission.submitterQq });
      person.approvedBy = admin.qq;
      db.people.unshift(person);
      payload.personId = person.id;
      payload.personIds = [person.id];
    }
    let incident = await normalizeIncident(payload);
    incident = stampCreate(incident, { qq: submission.submitterQq });
    incident.approvedBy = admin.qq;
    db.incidents.unshift(incident);
    incident.personIds.map((id) => db.people.find((item) => item.id === id)).filter(Boolean).forEach((person) => {
      person.updatedAt = new Date().toISOString();
    });
    submission.approvedTargetId = incident.id;
  }
  submission.status = "approved";
  submission.reviewedBy = admin.qq;
  submission.reviewedAt = new Date().toISOString();
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const db = readDb();
  let dirtySession = false;

  if (req.method === "GET" && url.pathname === "/api/data") {
    const me = getSessionUser(req, db);
    if (me === null) dirtySession = true;
    if (dirtySession) writeDb(db);
    return sendJson(res, 200, { people: db.people, incidents: db.incidents, users: db.users.map(publicUserBrief), me: publicUser(me) });
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const me = getSessionUser(req, db);
    if (dirtySession) writeDb(db);
    return sendJson(res, 200, { me: publicUser(me) });
  }

  if (req.method === "GET" && url.pathname === "/api/gas/search") {
    const q = String(url.searchParams.get("q") || "").trim();
    if (!q) return sendJson(res, 200, { results: [] });
    const before = JSON.stringify(db.gasUsers || []);
    const results = await searchGasUsers(q, db).catch(() => []);
    if (JSON.stringify(db.gasUsers || []) !== before) writeDb(db);
    return sendJson(res, 200, { results });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const input = await readJson(req);
    const user = db.users.find((item) => item.qq === String(input.qq || "").trim());
    if (!user || !verifyPassword(input.password || "", user)) {
      return sendJson(res, 401, { error: "账号或密码错误" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    db.sessions[token] = {
      qq: user.qq,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + sessionMaxAge).toISOString()
    };
    writeDb(db);
    return sendJson(res, 200, { me: publicUser(user) }, {
      "Set-Cookie": `dlrs_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionMaxAge / 1000)}`
    });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req).dlrs_session;
    if (token) delete db.sessions[token];
    writeDb(db);
    return sendJson(res, 200, { ok: true }, { "Set-Cookie": "dlrs_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const input = await readJson(req);
    const next = String(input.newPassword || "");
    if (next.length < 8) return sendJson(res, 400, { error: "新密码至少 8 位" });
    if (!verifyPassword(input.oldPassword || "", user)) return sendJson(res, 400, { error: "旧密码错误" });
    user.passwordSalt = crypto.randomBytes(16).toString("hex");
    user.passwordHash = passwordHash(next, user.passwordSalt);
    delete user.initialPassword;
    user.mustChangePassword = false;
    user.updatedAt = new Date().toISOString();
    writeDb(db);
    return sendJson(res, 200, { me: publicUser(user) });
  }

  if (req.method === "PUT" && url.pathname === "/api/me/profile") {
    const user = requireUser(req, res, db);
    if (!user) return;
    const input = await readJson(req);
    user.username = String(input.username || "").trim();
    if (input.avatarData) user.avatar = saveDataUrl(input.avatarData, "user-avatar");
    user.updatedAt = new Date().toISOString();
    writeDb(db);
    return sendJson(res, 200, { me: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/uploads/import-image") {
    const user = requireUser(req, res, db);
    if (!user) return;
    if (user.mustChangePassword) return sendJson(res, 403, { error: "请先修改初始密码" });
    const input = await readJson(req);
    const src = String(input.src || "").trim();
    const local = await importRemoteImage(src).catch(() => "");
    if (!local) return sendJson(res, 400, { error: "图片转存失败，请先保存图片后再上传" });
    return sendJson(res, 200, { src: local });
  }

  if (req.method === "POST" && url.pathname === "/api/people") {
    const user = requireUser(req, res, db);
    if (!user) return;
    if (user.mustChangePassword) return sendJson(res, 403, { error: "请先修改初始密码" });
    const input = await readJson(req);
    const accountError = validateAccounts(input.accounts);
    if (accountError) return sendJson(res, 400, { error: accountError });
    let person = await normalizePerson(input);
    person = stampCreate(person, user);
    if (isAdminRole(user)) {
      db.people.unshift(person);
      writeDb(db);
      return sendJson(res, 200, { ...person, pending: false });
    }
    const submission = newSubmission("person", person, user);
    db.submissions.unshift(submission);
    writeDb(db);
    return sendJson(res, 202, { pending: true, submission });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/people/")) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const index = db.people.findIndex((person) => person.id === id);
    if (index < 0) return sendJson(res, 404, { error: "人物不存在" });
    const input = await readJson(req);
    const accountError = validateAccounts(input.accounts);
    if (accountError) return sendJson(res, 400, { error: accountError });
    db.people[index] = stampUpdate(await normalizePerson({ ...input, id }, db.people[index]), db.people[index], user);
    writeDb(db);
    return sendJson(res, 200, db.people[index]);
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/people/")) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const index = db.people.findIndex((person) => person.id === id);
    if (index < 0) return sendJson(res, 404, { error: "人物不存在" });
    const [person] = db.people.splice(index, 1);
    const before = db.incidents.length;
    db.incidents = db.incidents.map((incident) => {
      const ids = Array.isArray(incident.personIds) ? incident.personIds : [incident.personId].filter(Boolean);
      const nextIds = ids.filter((personId) => personId !== id);
      return { ...incident, personIds: nextIds, personId: nextIds[0] || "" };
    }).filter((incident) => incident.personIds.length);
    writeDb(db);
    return sendJson(res, 200, { ok: true, person, deletedIncidents: before - db.incidents.length });
  }

  if (req.method === "POST" && url.pathname === "/api/incidents") {
    const user = requireUser(req, res, db);
    if (!user) return;
    if (user.mustChangePassword) return sendJson(res, 403, { error: "请先修改初始密码" });
    const input = await readJson(req);
    if (!validateDateValue(input.date)) return sendJson(res, 400, { error: "日期年份必须是四位数" });
    if (!isAdminRole(user)) {
      input.pinned = false;
      input.recommended = false;
      let incident = await normalizeIncident(input);
      incident = stampCreate(incident, user);
      const submission = newSubmission("incident", incident, user);
      db.submissions.unshift(submission);
      writeDb(db);
      return sendJson(res, 202, { pending: true, submission });
    }
    if (!input.personId && !(Array.isArray(input.personIds) && input.personIds.length)) {
      let person = await normalizePerson({ name: "未归档人物", status: "controversial" });
      person = stampCreate(person, user);
      db.people.unshift(person);
      input.personId = person.id;
      input.personIds = [person.id];
    }
    let incident = await normalizeIncident(input);
    incident = stampCreate(incident, user);
    db.incidents.unshift(incident);
    incident.personIds.map((id) => db.people.find((item) => item.id === id)).filter(Boolean).forEach((person) => {
      person.updatedAt = new Date().toISOString();
    });
    writeDb(db);
    return sendJson(res, 200, { ...incident, pending: false });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/incidents/") && url.pathname.endsWith("/view")) {
    const id = decodeURIComponent(url.pathname.slice("/api/incidents/".length, -"/view".length));
    const incident = db.incidents.find((item) => item.id === id);
    if (!incident) return sendJson(res, 404, { error: "事件不存在" });
    incident.viewCount = Number(incident.viewCount || 0) + 1;
    incident.updatedAt = incident.updatedAt || new Date().toISOString();
    writeDb(db);
    return sendJson(res, 200, { ok: true, viewCount: incident.viewCount });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/incidents/")) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const index = db.incidents.findIndex((incident) => incident.id === id);
    if (index < 0) return sendJson(res, 404, { error: "事件不存在" });
    const input = await readJson(req);
    if (!validateDateValue(input.date)) return sendJson(res, 400, { error: "日期年份必须是四位数" });
    db.incidents[index] = stampUpdate(await normalizeIncident({ ...input, id }, db.incidents[index]), db.incidents[index], user);
    db.incidents[index].personIds.map((personId) => db.people.find((item) => item.id === personId)).filter(Boolean).forEach((person) => {
      person.updatedAt = new Date().toISOString();
    });
    writeDb(db);
    return sendJson(res, 200, db.incidents[index]);
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/incidents/")) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const id = decodeURIComponent(url.pathname.split("/").pop());
    const index = db.incidents.findIndex((incident) => incident.id === id);
    if (index < 0) return sendJson(res, 404, { error: "事件不存在" });
    const [incident] = db.incidents.splice(index, 1);
    (incident.personIds || [incident.personId]).map((personId) => db.people.find((item) => item.id === personId)).filter(Boolean).forEach((person) => {
      person.updatedAt = new Date().toISOString();
    });
    writeDb(db);
    return sendJson(res, 200, { ok: true, incident });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/submissions") {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    return sendJson(res, 200, { submissions: db.submissions });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    const user = requireSuperAdmin(req, res, db);
    if (!user) return;
    return sendJson(res, 200, {
      users: db.users.map((item) => ({
        qq: item.qq,
        username: item.username || "",
        avatar: item.avatar || "",
        role: item.role || "user",
        mustChangePassword: !!item.mustChangePassword,
        createdAt: item.createdAt || ""
      }))
    });
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/admin/users/")) {
    const user = requireSuperAdmin(req, res, db);
    if (!user) return;
    const qq = decodeURIComponent(url.pathname.split("/").pop());
    const target = db.users.find((item) => item.qq === qq);
    if (!target) return sendJson(res, 404, { error: "用户不存在" });
    const input = await readJson(req);
    const nextRole = String(input.role || "");
    if (!["user", "admin", "superadmin"].includes(nextRole)) return sendJson(res, 400, { error: "角色无效" });
    target.role = nextRole;
    target.updatedAt = new Date().toISOString();
    writeDb(db);
    return sendJson(res, 200, { user: publicUser(target) });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/admin/submissions/")) {
    const user = requireAdmin(req, res, db);
    if (!user) return;
    const parts = url.pathname.split("/");
    const action = parts.pop();
    const id = decodeURIComponent(parts.pop());
    const submission = db.submissions.find((item) => item.id === id);
    if (!submission) return sendJson(res, 404, { error: "提交不存在" });
    if (submission.status !== "pending") return sendJson(res, 400, { error: "该提交已处理" });
    if (action === "approve") {
      await approveSubmission(db, submission, user);
    } else if (action === "reject") {
      submission.status = "rejected";
      submission.reviewedBy = user.qq;
      submission.reviewedAt = new Date().toISOString();
    } else {
      return sendJson(res, 404, { error: "接口不存在" });
    }
    writeDb(db);
    return sendJson(res, 200, { submission });
  }

  return sendJson(res, 404, { error: "接口不存在" });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) return await handleApi(req, res);
    serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "服务器错误" });
  }
}).listen(port, () => {
  console.log(`DLRS 人物志已启动: http://localhost:${port}/`);
});
