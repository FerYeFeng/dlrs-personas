const STORAGE_KEY = "dlrs-personas-v2";
const LEGACY_KEY = "dlrs-personas-v1";
const THEME_KEY = "dlrs-personas-theme";
const NAV_KEY = "dlrs-nav-open";

const demoData = {
  people: [],
  incidents: [],
  users: []
};

let state = loadState();
let serverAvailable = false;
let currentUser = null;

function $(selector) {
  return document.querySelector(selector);
}

function $all(selector) {
  return [...document.querySelectorAll(selector)];
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
  if (!saved) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(demoData));
    return structuredClone(demoData);
  }
  try {
    const parsed = JSON.parse(saved);
    parsed.people ||= [];
    parsed.incidents ||= [];
    parsed.users ||= [];
    const demoIds = new Set(parsed.people.filter((person) => ["示例作者A", "示例创作者B"].includes(person.name)).map((person) => person.id));
    parsed.people = parsed.people.filter((person) => !demoIds.has(person.id));
    parsed.incidents = parsed.incidents.filter((incident) => {
      const ids = Array.isArray(incident.personIds) ? incident.personIds : [incident.personId].filter(Boolean);
      return !ids.some((id) => demoIds.has(id));
    });
    parsed.people = parsed.people.map((person) => ({
      avatar: "",
      banner: "",
      bioHtml: person.bioHtml || "",
      updatedAt: person.createdAt || new Date().toISOString(),
      ...person
    }));
    parsed.incidents = parsed.incidents.map((incident) => ({
      images: [],
      result: "",
      pinned: false,
      recommended: false,
      viewCount: 0,
      personIds: incident.personIds || [incident.personId].filter(Boolean),
      ...incident
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return structuredClone(demoData);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `API ${response.status}`);
  return data;
}

async function loadServerState() {
  try {
    const data = await apiRequest("/api/data");
    state = { people: data.people || [], incidents: data.incidents || [], users: data.users || [] };
    currentUser = data.me || null;
    state.people ||= [];
    state.incidents ||= [];
    saveState();
    serverAvailable = true;
  } catch {
    serverAvailable = false;
  }
}

function personPayloadForServer(payload) {
  return {
    ...payload,
    avatarData: payload.avatar?.startsWith("data:") ? payload.avatar : "",
    bannerData: payload.banner?.startsWith("data:") ? payload.banner : "",
    avatar: payload.avatar?.startsWith("data:") ? "" : payload.avatar,
    banner: payload.banner?.startsWith("data:") ? "" : payload.banner
  };
}

function profilePayloadForServer(payload) {
  return {
    username: payload.username,
    avatarData: payload.avatar?.startsWith("data:") ? payload.avatar : ""
  };
}

function incidentPayloadForServer(payload) {
  return { ...payload };
}

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return crypto.randomUUID();
  const random = globalThis.crypto?.getRandomValues
    ? crypto.getRandomValues(new Uint32Array(2)).join("")
    : Math.random().toString(36).slice(2);
  return `id-${Date.now().toString(36)}-${random}`;
}

function readImageFile(file, maxWidth = 1400, quality = 0.84) {
  if (!file || !file.type?.startsWith("image/")) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const image = new Image();
      image.onerror = reject;
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function readImageFiles(files, maxWidth = 1400) {
  return Promise.all([...files].filter((file) => file.type.startsWith("image/")).map((file) => readImageFile(file, maxWidth)));
}

function isAllowedImageSrc(src = "") {
  return src.startsWith("data:image/") || src.startsWith("/uploads/") || src.startsWith("./uploads/") || /^https?:\/\//i.test(src);
}

function sanitizeFontSize(value = "") {
  const numeric = parseInt(String(value).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(numeric)) return "";
  return `${Math.max(10, Math.min(72, numeric))}px`;
}

function sanitizeImageWidth(value = "") {
  const named = { small: "260px", medium: "420px", large: "620px" };
  if (named[String(value).trim()]) return named[String(value).trim()];
  const numeric = parseInt(String(value).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(numeric)) return "";
  return `${Math.max(120, Math.min(1200, numeric))}px`;
}

function normalizeHttpUrl(value = "") {
  const url = String(value).trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(url)) return `https://${url}`;
  return "";
}

function linkifyText(text = "") {
  const pattern = /(https?:\/\/[^\s<]+|[\w.-]+\.[a-z]{2,}(?:\/[^\s<]*)?)/gi;
  let lastIndex = 0;
  let html = "";
  String(text).replace(pattern, (match, _url, offset) => {
    html += escapeHtml(String(text).slice(lastIndex, offset));
    const href = normalizeHttpUrl(match);
    html += href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(match)}</a>` : escapeHtml(match);
    lastIndex = offset + match.length;
    return match;
  });
  return html + escapeHtml(String(text).slice(lastIndex));
}

function sanitizeRichHtml(html = "") {
  const template = document.createElement("template");
  template.innerHTML = String(html);
  const allowed = new Set(["P", "DIV", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BLOCKQUOTE", "A", "IMG", "SPAN"]);
  const walk = (node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE && child.parentElement?.tagName !== "A" && child.nodeValue && /(https?:\/\/[^\s<]+|[\w.-]+\.[a-z]{2,}(?:\/[^\s<]*)?)/i.test(child.nodeValue)) {
        const template = document.createElement("template");
        template.innerHTML = linkifyText(child.nodeValue);
        child.replaceWith(...template.content.childNodes);
        return;
      }
      if (child.nodeType === Node.ELEMENT_NODE) {
        if (!allowed.has(child.tagName)) {
          walk(child);
          child.replaceWith(...child.childNodes);
          return;
        }
        const href = child.getAttribute("href") || "";
        const src = child.getAttribute("src") || "";
        const fontSize = sanitizeFontSize(child.style?.fontSize || "");
        const imageWidth = sanitizeImageWidth(child.style?.width || child.dataset?.imageWidth || child.dataset?.imageSize || child.getAttribute("width") || "");
        [...child.attributes].forEach((attr) => child.removeAttribute(attr.name));
        if (child.tagName === "A") {
          if (/^https?:\/\//i.test(href)) {
            child.setAttribute("href", href);
            child.setAttribute("target", "_blank");
            child.setAttribute("rel", "noopener");
          }
        }
        if (child.tagName === "SPAN" && fontSize) {
          child.style.fontSize = fontSize;
        }
        if (child.tagName === "IMG") {
          if (isAllowedImageSrc(src)) {
            child.setAttribute("src", src);
            child.setAttribute("alt", "事件图片");
            if (imageWidth) child.style.width = imageWidth;
          } else {
            child.remove();
            return;
          }
        }
        walk(child);
      }
    });
  };
  walk(template.content);
  return template.innerHTML.trim();
}

function plainTextToHtml(text = "") {
  return String(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${linkifyText(line)}</p>`)
    .join("");
}

function richTextToPlainText(html = "") {
  const template = document.createElement("template");
  template.innerHTML = sanitizeRichHtml(html);
  return template.content.textContent || "";
}

function personBioHtml(person) {
  return sanitizeRichHtml(person.bioHtml || plainTextToHtml(person.bio || ""));
}

function legacyIncidentHtml(incident) {
  const parts = [];
  if (incident.contentHtml) parts.push(incident.contentHtml);
  if (!incident.contentHtml && incident.detail) parts.push(plainTextToHtml(incident.detail));
  if (!incident.contentHtml && incident.evidence) parts.push(`<blockquote>${plainTextToHtml(incident.evidence)}</blockquote>`);
  if (!incident.contentHtml && incident.images?.length) {
    parts.push((incident.images || []).map((image) => `<p><img src="${escapeHtml(image)}" alt="事件图片"></p>`).join(""));
  }
  return sanitizeRichHtml(parts.join(""));
}

function incidentPlainText(incident) {
  const html = legacyIncidentHtml(incident);
  if (!html) return `${incident.detail || ""} ${incident.evidence || ""}`;
  return richTextToPlainText(html);
}

function incidentCoverImage(incident) {
  const person = peopleForIncident(incident)[0];
  return person?.avatar || person?.banner || "";
}

function incidentCoverTiles(incident) {
  const people = peopleForIncident(incident);
  const tiles = people.length ? people : [{ name: incident.title || "?", avatar: "", banner: "" }];
  return tiles.slice(0, 4).map((person) => {
    const image = person.avatar || person.banner || "";
    return `<div class="recent-cover-tile"${imageStyle(image)}>${image ? "" : escapeHtml((person.name || "?").slice(0, 1))}</div>`;
  }).join("");
}

function imageStyle(url) {
  return url ? ` style="background-image: url('${url}')"` : "";
}

function userByQq(qq) {
  return (state.users || []).find((user) => user.qq === qq);
}

function userName(qq) {
  if (!qq) return "未知用户";
  const user = userByQq(qq);
  return user?.username || qq;
}

function userLink(qq) {
  const label = escapeHtml(userName(qq));
  return qq ? `<a class="a" href="${qqProfileLink(qq)}">${label}</a>` : label;
}

function auditMeta(record) {
  if (!isSuperAdmin()) return "";
  const parts = [];
  if (record.createdBy) parts.push(`创建：${userLink(record.createdBy)}`);
  if (record.updatedBy && record.updatedBy !== record.createdBy) parts.push(`修改：${userLink(record.updatedBy)}`);
  return parts.length ? `<p class="audit-meta">${parts.join(" · ")}</p>` : "";
}

function historyList(record) {
  if (!isSuperAdmin()) return "";
  const history = Array.isArray(record.history) ? record.history : [];
  if (!history.length) return "";
  return `
    <details class="history-box">
      <summary>历史记录</summary>
      <div class="history-list">
        ${history.slice().reverse().map((item) => `<p>${escapeHtml(item.at || "")} · ${escapeHtml(item.action || "记录")} · ${userLink(item.by)}</p>`).join("")}
      </div>
    </details>
  `;
}

function applyTheme(theme) {
  const isLight = theme === "light";
  document.body.classList.toggle("theme-light", isLight);
  document.body.classList.toggle("theme-dark", !isLight);
  const toggle = $("#themeToggle");
  if (toggle) toggle.checked = isLight;
}

function isAdmin() {
  return currentUser?.role === "admin" || currentUser?.role === "superadmin";
}

function isSuperAdmin() {
  return currentUser?.role === "superadmin";
}

function roleText(role) {
  return {
    superadmin: "超级管理员",
    admin: "管理员",
    user: "普通用户"
  }[role] || "普通用户";
}

function needsLogin() {
  return !currentUser;
}

function guardRestrictedPages() {
  const current = location.pathname.split("/").pop() || "index.html";
  const addPages = new Set(["add.html", "add-person.html", "add-incident.html"]);
  const editPages = new Set(["edit-person.html", "edit-incident.html"]);
  if ((addPages.has(current) || editPages.has(current) || current === "admin.html" || current === "users.html") && needsLogin()) {
    location.href = `./login.html?next=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}`;
    return false;
  }
  if (currentUser?.mustChangePassword && current !== "change-password.html") {
    location.href = "./change-password.html";
    return false;
  }
  if ((editPages.has(current) || current === "admin.html") && !isAdmin()) {
    document.querySelector(".mdui-container")?.replaceChildren();
    const container = document.querySelector(".mdui-container");
    if (container) container.innerHTML = `<section class="section first-section"><div class="empty">需要管理员权限</div></section>`;
    return false;
  }
  if (current === "users.html" && !isSuperAdmin()) {
    document.querySelector(".mdui-container")?.replaceChildren();
    const container = document.querySelector(".mdui-container");
    if (container) container.innerHTML = `<section class="section first-section"><div class="empty">需要超级管理员权限</div></section>`;
    return false;
  }
  return true;
}

function applyAuthUi() {
  $all(".nav").forEach((nav) => {
    if (isAdmin() && !nav.querySelector('[href="./admin.html"]')) {
      nav.insertAdjacentHTML("beforeend", '<a href="./admin.html" data-admin-link><i class="material-icons">verified_user</i><span>审核</span></a>');
    }
    if (isSuperAdmin() && !nav.querySelector('[href="./users.html"]')) {
      nav.insertAdjacentHTML("beforeend", '<a href="./users.html" data-users-link><i class="material-icons">manage_accounts</i><span>用户</span></a>');
    }
    if (!nav.querySelector('[href="./login.html"]') && !currentUser) {
      nav.insertAdjacentHTML("beforeend", '<a href="./login.html"><i class="material-icons">login</i><span>登录</span></a>');
    }
  });
  document.body.classList.toggle("is-admin", isAdmin());
  document.body.classList.toggle("is-superadmin", isSuperAdmin());
  document.body.classList.toggle("is-logged-in", !!currentUser);
}

function splitList(value = "") {
  return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
}

function tagsFromForm(form) {
  const input = form.elements.tags;
  const entry = form.querySelector("[data-tag-entry]");
  const pendingTag = String(entry?.value || "").trim();
  if (!input) return pendingTag ? [pendingTag] : [];
  try {
    const parsed = JSON.parse(input.value || "[]");
    if (Array.isArray(parsed)) {
      const tags = parsed.map((item) => String(item).trim()).filter(Boolean);
      if (pendingTag && !tags.includes(pendingTag)) tags.push(pendingTag);
      return tags;
    }
  } catch {}
  const tags = splitList(input.value || "");
  if (pendingTag && !tags.includes(pendingTag)) tags.push(pendingTag);
  return tags;
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

function validateAccounts(accounts) {
  if (accounts.qq && !/^\d+$/.test(accounts.qq)) return "QQ 号必须为纯数字";
  if (accounts.bilibili && !isValidHttpUrl(accounts.bilibili)) return "Bilibili 必须填写完整链接";
  if (accounts.douyin && !isValidHttpUrl(accounts.douyin)) return "抖音必须填写完整链接";
  if (accounts.gas && /[\s/\\?#]/.test(accounts.gas)) return "GAS UID 不能包含空格或路径符号";
  return "";
}

function isValidDateValue(value) {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function qqProfileLink(qq) {
  const uin = String(qq || "").trim();
  if (isMobileDevice()) {
    return `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${encodeURIComponent(uin)}`;
  }
  const actionParams = encodeURIComponent(JSON.stringify({
    uin,
    sourceType: "QrCodeShareBuddyLink"
  }));
  return `tencent://ntqq-open?subCmd=profile&action=openMiniBuddyProfile&actionParams=${actionParams}`;
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent || "");
}

function gasProfileLink(uid) {
  return `https://chinadlrs.com/space/${encodeURIComponent(String(uid))}`;
}

function statusText(status) {
  return {
    active: "活跃",
    inactive: "退圈 / 不活跃",
    controversial: "争议中",
    banned: "已封禁",
    cleared: "已澄清"
  }[status] || status || "未标注";
}

function credibilityText(value) {
  return {
    confirmed: "已核实",
    disputed: "争议中",
    cleared: "已澄清",
    unverified: "证据不足"
  }[value] || value || "证据不足";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function personById(id) {
  return state.people.find((person) => person.id === id);
}

function incidentPersonIds(incident) {
  const ids = Array.isArray(incident.personIds) ? incident.personIds : [];
  if (incident.personId && !ids.includes(incident.personId)) ids.unshift(incident.personId);
  return ids.filter(Boolean);
}

function peopleForIncident(incident) {
  return incidentPersonIds(incident).map(personById).filter(Boolean);
}

function incidentPeopleLinks(incident) {
  const people = peopleForIncident(incident);
  return people.length
    ? people.map((person) => `<a class="a" href="./person.html?id=${encodeURIComponent(person.id)}">${escapeHtml(person.name)}</a>`).join("、")
    : "未知人物";
}

function incidentsForPerson(id) {
  return state.incidents.filter((incident) => incidentPersonIds(incident).includes(id));
}

function accountPills(person) {
  const accounts = person.accounts || {};
  return [
    accounts.qq && `<a class="account-pill qq" href="${qqProfileLink(accounts.qq)}">QQ ${escapeHtml(accounts.qq)}</a>`,
    accounts.bilibili && `<a class="account-pill bilibili" href="${escapeHtml(accounts.bilibili)}" target="_blank" rel="noopener">Bilibili</a>`,
    accounts.douyin && `<a class="account-pill douyin" href="${escapeHtml(accounts.douyin)}" target="_blank" rel="noopener">抖音</a>`,
    accounts.gas && `<a class="account-pill gas" href="${gasProfileLink(accounts.gas)}" target="_blank" rel="noopener">GAS</a>`
  ].filter(Boolean).join("") || `<span class="muted">暂无账号</span>`;
}

function personCard(person) {
  const incidentCount = incidentsForPerson(person.id).length;
  return `
    <article class="person-card" data-href="./person.html?id=${encodeURIComponent(person.id)}" tabindex="0">
      <div class="person-banner person-card-avatar"${imageStyle(person.avatar)}>${person.avatar ? "" : escapeHtml(person.name.slice(0, 1))}</div>
      <div class="person-body">
        <h3>${escapeHtml(person.name)}</h3>
        <div class="muted">${escapeHtml(statusText(person.status))} · ${incidentCount} 条事件</div>
        <div class="tags">
          ${(person.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <p>${escapeHtml(person.bio || richTextToPlainText(personBioHtml(person)) || "暂无简介")}</p>
        ${auditMeta(person)}
        <div class="accounts">${accountPills(person)}</div>
      </div>
    </article>
  `;
}

function incidentItem(incident) {
  return `
    <article class="timeline-item" data-incident-id="${escapeHtml(incident.id)}">
      <div class="timeline-head">
        <h3><a class="a incident-title-link" data-incident-view="${escapeHtml(incident.id)}" href="./incident.html?id=${encodeURIComponent(incident.id)}">${escapeHtml(incident.title)}</a></h3>
        <div class="incident-flags">${incidentFlags(incident)}</div>
        ${isAdmin() ? `
          <a class="a edit-link" href="./edit-incident.html?id=${encodeURIComponent(incident.id)}">编辑</a>
          <button class="text-danger delete-incident-button" type="button" data-delete-incident="${escapeHtml(incident.id)}">删除</button>
        ` : ""}
      </div>
      <p>${escapeHtml(incident.date || "未填写日期")} · ${escapeHtml(incident.category || "未标注")} · ${incidentPeopleLinks(incident)}</p>
      ${auditMeta(incident)}
      <div class="incident-content">${legacyIncidentHtml(incident) || `<p>暂无描述</p>`}</div>
      ${incident.result ? `<p><b>处理结果：</b>${escapeHtml(incident.result)}</p>` : ""}
      ${historyList(incident)}
    </article>
  `;
}

function getSortedPeople() {
  return [...state.people].sort((a, b) => {
    return comparePersonNames(a, b);
  });
}

function comparePersonNames(a, b) {
  const nameA = (a.name || "").trim();
  const nameB = (b.name || "").trim();
  return nameA.localeCompare(nameB, "zh-Hans-CN", { sensitivity: "base", numeric: true })
    || (a.id || "").localeCompare(b.id || "");
}

function filterPeople(keyword) {
  const q = keyword.trim().toLowerCase();
  const people = !q ? state.people : state.people.filter((person) => {
    const text = [
      person.name,
      person.tags?.join(" "),
      person.bio,
      richTextToPlainText(personBioHtml(person)),
      person.accounts?.qq,
      person.accounts?.bilibili,
      person.accounts?.douyin,
      person.accounts?.gas,
      ...incidentsForPerson(person.id).map((item) => `${item.title} ${incidentPlainText(item)}`)
    ].join(" ").toLowerCase();
    return text.includes(q);
  });
  return [...people].sort(comparePersonNames);
}

function incidentSearchText(incident) {
  const people = peopleForIncident(incident);
  return [
    incident.title,
    incident.category,
    incident.result,
    incidentPlainText(incident),
    ...people.map((person) => [
      person.name,
      person.tags?.join(" "),
      person.bio,
      richTextToPlainText(personBioHtml(person)),
      person.accounts?.qq,
      person.accounts?.bilibili,
      person.accounts?.douyin,
      person.accounts?.gas
    ].join(" "))
  ].join(" ").toLowerCase();
}

function filterIncidents(keyword, source = state.incidents) {
  const q = keyword.trim().toLowerCase();
  return [...source]
    .sort(compareIncidents)
    .filter((incident) => !q || incidentSearchText(incident).includes(q));
}

function compareIncidents(a, b) {
  return Number(!!b.pinned) - Number(!!a.pinned)
    || (b.date || "").localeCompare(a.date || "")
    || (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
}

function sortPinnedIncidents(incidents) {
  return [...incidents].filter((incident) => incident.pinned).sort((a, b) =>
    (b.date || "").localeCompare(a.date || "")
    || (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "")
  );
}

function sortHotIncidents(incidents) {
  return [...incidents].filter((incident) => !incident.pinned).sort((a, b) => {
    const score = Number(b.viewCount || 0) - Number(a.viewCount || 0);
    return score
      || Number(!!b.recommended) - Number(!!a.recommended)
      || (b.updatedAt || b.date || "").localeCompare(a.updatedAt || a.date || "");
  });
}

function sortRecentIncidents(incidents) {
  return [...incidents].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)
    || (b.updatedAt || b.createdAt || b.date || "").localeCompare(a.updatedAt || a.createdAt || a.date || ""));
}

function incidentFlags(incident) {
  return [
    incident.pinned && `<span class="tag flag pinned">置顶</span>`,
    incident.recommended && `<span class="tag flag recommended">推荐</span>`
  ].filter(Boolean).join("");
}

function homeIncidentCard(incident) {
  return `
    <a class="recent-card" data-incident-view="${escapeHtml(incident.id)}" href="./incident.html?id=${encodeURIComponent(incident.id)}">
      <div class="recent-cover">${incidentCoverTiles(incident)}</div>
      <div class="recent-body">
        <div class="incident-flags">${incidentFlags(incident)}</div>
        <h3>${escapeHtml(incident.title)}</h3>
        <p>${escapeHtml(incident.date || "未填写日期")} · ${peopleForIncident(incident).map((person) => escapeHtml(person.name)).join("、") || "未知人物"} · ${Number(incident.viewCount || 0)} 次点击</p>
      </div>
    </a>
  `;
}

function renderIncidentDetail() {
  const root = $("#incidentDetail");
  if (!root) return;
  const id = new URLSearchParams(location.search).get("id");
  const incident = state.incidents.find((item) => item.id === id);
  if (!incident) {
    root.innerHTML = `<div class="empty">事件不存在</div>`;
    return;
  }
  document.title = `${incident.title} - DLRS 人物志`;
  root.innerHTML = `
    <section class="section first-section incident-detail box2 br8" data-incident-id="${escapeHtml(incident.id)}">
      <div class="timeline-head">
        <h1>${escapeHtml(incident.title)}</h1>
        <div class="incident-flags">${incidentFlags(incident)}</div>
        ${isAdmin() ? `
          <a class="a edit-link" href="./edit-incident.html?id=${encodeURIComponent(incident.id)}">编辑</a>
          <button class="text-danger delete-incident-button" type="button" data-delete-incident="${escapeHtml(incident.id)}">删除</button>
        ` : ""}
      </div>
      <p class="muted">${escapeHtml(incident.date || "未填写日期")} · ${escapeHtml(incident.category || "未标注")} · ${Number(incident.viewCount || 0)} 次点击</p>
      <div class="tags">${peopleForIncident(incident).map((person) => `<a class="tag" href="./person.html?id=${encodeURIComponent(person.id)}">${escapeHtml(person.name)}</a>`).join("") || `<span class="muted">未关联人物</span>`}</div>
      ${auditMeta(incident)}
      <div class="incident-content incident-detail-content">${legacyIncidentHtml(incident) || `<p>暂无描述</p>`}</div>
      ${incident.result ? `<p class="incident-result"><b>处理结果：</b>${escapeHtml(incident.result)}</p>` : ""}
      ${historyList(incident)}
    </section>
  `;
  bindDeleteButtons();
}

function recordIncidentView(id) {
  if (!id) return;
  const incident = state.incidents.find((item) => item.id === id);
  if (incident) {
    incident.viewCount = Number(incident.viewCount || 0) + 1;
    saveState();
  }
  if (!serverAvailable) return;
  const url = `/api/incidents/${encodeURIComponent(id)}/view`;
  if (navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob(["{}"], { type: "application/json" }));
    return;
  }
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    keepalive: true
  }).catch(() => {});
}

function renderStats() {
  const peopleCount = $("#peopleCount");
  const incidentCount = $("#incidentCount");
  const accountCount = $("#accountCount");
  if (peopleCount) peopleCount.textContent = state.people.length;
  if (incidentCount) incidentCount.textContent = state.incidents.length;
  if (accountCount) {
    accountCount.textContent = state.people.reduce((sum, person) => sum + Object.values(person.accounts || {}).filter(Boolean).length, 0);
  }
}

function renderHome() {
  const pinnedGrid = $("#pinnedGrid");
  const hotGrid = $("#hotGrid");
  const recentGrid = $("#recentGrid");
  const input = $("#homeSearchInput");
  if (recentGrid || hotGrid || pinnedGrid) {
    const render = () => {
      const incidents = filterIncidents(input?.value || "");
      const pinned = sortPinnedIncidents(incidents).slice(0, 6);
      const hot = sortHotIncidents(incidents).slice(0, 6);
      const recent = sortRecentIncidents(incidents).slice(0, 6);
      if (pinnedGrid) pinnedGrid.innerHTML = pinned.length ? pinned.map(homeIncidentCard).join("") : `<div class="empty">暂无置顶事件</div>`;
      if (hotGrid) hotGrid.innerHTML = hot.length ? hot.map(homeIncidentCard).join("") : `<div class="empty">暂无热门事件</div>`;
      if (recentGrid) recentGrid.innerHTML = recent.length ? recent.map(homeIncidentCard).join("") : `<div class="empty">暂无最近更新</div>`;
    };
    input?.addEventListener("input", render);
    render();
  }
  renderStats();
}

function renderPeoplePage() {
  const grid = $("#peopleGrid");
  if (!grid) return;
  const input = $("#searchInput");
  const render = () => {
    const people = filterPeople(input?.value || "");
    grid.innerHTML = people.length ? people.map(personCard).join("") : `<div class="empty">没有找到人物档案</div>`;
  };
  input?.addEventListener("input", render);
  render();
}

function bindCardNavigation() {
  document.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (link) {
      const incidentLink = link.closest("[data-incident-view]");
      if (incidentLink) recordIncidentView(incidentLink.dataset.incidentView);
      return;
    }
    const card = event.target.closest("[data-href]");
    if (card) location.href = card.dataset.href;
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-href]");
    if (!card) return;
    event.preventDefault();
    location.href = card.dataset.href;
  });
}

function renderIncidentsPage() {
  const list = $("#incidentList");
  if (!list) return;
  const input = $("#searchInput");
  const render = () => {
    const keyword = (input?.value || "").trim().toLowerCase();
    const incidents = filterIncidents(keyword);
    list.innerHTML = incidents.length ? incidents.map(incidentItem).join("") : `<div class="empty">暂无事件记录</div>`;
    bindDeleteButtons();
  };
  input?.addEventListener("input", render);
  render();
}

function fillIncidentPersonSelect() {
  const params = new URLSearchParams(location.search);
  const selectedIds = [];
  const personId = params.get("personId") || params.get("person");
  if (personId && personById(personId)) selectedIds.push(personId);
  renderIncidentPersonPicker(selectedIds);
}

function renderIncidentPersonPicker(selectedIds = []) {
  const picker = $("#incidentPersonPicker");
  if (!picker) return;
  const name = picker.dataset.name || "personIds";
  const selected = new Set(selectedIds.filter(Boolean));
  const sortedPeople = getSortedPeople();
  const selectedPeople = sortedPeople.filter((person) => selected.has(person.id));
  picker.innerHTML = `
    <button class="person-picker__button" type="button" aria-expanded="false">
      <span>${selectedPeople.length ? selectedPeople.map((person) => escapeHtml(person.name)).join("、") : "选择关联人物"}</span>
      <i class="material-icons">expand_more</i>
    </button>
    <div class="person-picker__menu">
      ${sortedPeople.length ? sortedPeople.map((person) => `
        <label class="person-picker__option">
          <input type="checkbox" value="${escapeHtml(person.id)}" ${selected.has(person.id) ? "checked" : ""} />
          <span>${escapeHtml(person.name)}</span>
        </label>
      `).join("") : `<div class="person-picker__empty">暂无人物，管理员保存时会自动创建未归档人物</div>`}
    </div>
    <div class="person-picker__values">
      ${[...selected].map((id) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(id)}" />`).join("")}
    </div>
  `;
  const button = picker.querySelector(".person-picker__button");
  const refresh = () => {
    const ids = [...picker.querySelectorAll('.person-picker__option input:checked')].map((input) => input.value);
    renderIncidentPersonPicker(ids);
    $("#incidentPersonPicker")?.classList.add("open");
    $("#incidentPersonPicker .person-picker__button")?.setAttribute("aria-expanded", "true");
  };
  button?.addEventListener("click", () => {
    picker.classList.toggle("open");
    button.setAttribute("aria-expanded", picker.classList.contains("open") ? "true" : "false");
  });
  picker.querySelectorAll('.person-picker__option input').forEach((input) => {
    input.addEventListener("change", refresh);
  });
}

function fillPersonForm(form, person) {
  form.elements.name.value = person.name || "";
  form.elements.qq.value = person.accounts?.qq || "";
  form.elements.bilibili.value = person.accounts?.bilibili || "";
  form.elements.douyin.value = person.accounts?.douyin || "";
  form.elements.gas.value = person.accounts?.gas || "";
  setTagInputValues(form, person.tags || []);
  const avatarCard = form.elements.avatar?.closest(".upload-card");
  const bannerCard = form.elements.banner?.closest(".upload-card");
  if (avatarCard) avatarCard.dataset.previewSrc = person.avatar || "";
  if (bannerCard) bannerCard.dataset.previewSrc = person.banner || "./uploads/default-banner.jpg";
  setUploadCardPreview(avatarCard, person.avatar || "");
  setUploadCardPreview(bannerCard, person.banner || "./uploads/default-banner.jpg");
  const bioEditor = $("#personBioEditor");
  if (bioEditor) bioEditor.innerHTML = personBioHtml(person);
  form.elements.status.value = person.status || "active";
}

function bindTagInput(form) {
  const root = form.querySelector("[data-tag-input]");
  if (!root || root.dataset.bound === "1") return;
  root.dataset.bound = "1";
  const list = root.querySelector("[data-tag-list]");
  const entry = root.querySelector("[data-tag-entry]");
  const hidden = root.querySelector('input[name="tags"]');
  const tags = [];

  const sync = () => {
    hidden.value = JSON.stringify(tags);
    list.innerHTML = tags.map((tag, index) => `
      <span class="tag-input__pill">
        ${escapeHtml(tag)}
        <button type="button" aria-label="删除 ${escapeHtml(tag)}" data-tag-remove="${index}">
          <i class="material-icons">close</i>
        </button>
      </span>
    `).join("");
  };
  const add = (value) => {
    const tag = String(value || "").trim();
    if (!tag || tags.includes(tag)) return;
    tags.push(tag);
    sync();
  };

  root.setTags = (values = []) => {
    tags.splice(0, tags.length, ...values.map((item) => String(item).trim()).filter(Boolean));
    sync();
  };
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tag-remove]");
    if (!button) return;
    tags.splice(Number(button.dataset.tagRemove), 1);
    sync();
    entry.focus();
  });
  root.addEventListener("click", () => entry.focus());
  entry.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      add(entry.value);
      entry.value = "";
    }
    if (event.key === "Backspace" && !entry.value && tags.length) {
      tags.pop();
      sync();
    }
  });
  entry.addEventListener("blur", () => {
    add(entry.value);
    entry.value = "";
  });
  sync();
}

function setTagInputValues(form, values = []) {
  const root = form.querySelector("[data-tag-input]");
  if (root?.setTags) {
    root.setTags(values);
  } else if (form.elements.tags) {
    form.elements.tags.value = JSON.stringify(values);
  }
}

function fillIncidentForm(form, incident) {
  renderIncidentPersonPicker(incidentPersonIds(incident));
  form.elements.title.value = incident.title || "";
  form.elements.date.value = incident.date || "";
  form.elements.category.value = incident.category || "其他";
  const editor = $("#incidentEditor");
  if (editor) editor.innerHTML = legacyIncidentHtml(incident);
  form.elements.result.value = incident.result || "";
  if (form.elements.pinned) form.elements.pinned.checked = !!incident.pinned;
  if (form.elements.recommended) form.elements.recommended.checked = !!incident.recommended;
}

let savedEditorRange = null;

function saveEditorSelection(editor) {
  const selection = getSelection();
  if (selection.rangeCount && editor.contains(selection.anchorNode)) {
    savedEditorRange = selection.getRangeAt(0).cloneRange();
  }
}

function restoreEditorSelection(editor) {
  editor.focus();
  const selection = getSelection();
  selection.removeAllRanges();
  if (savedEditorRange && editor.contains(savedEditorRange.commonAncestorContainer)) {
    selection.addRange(savedEditorRange);
  } else {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.addRange(range);
  }
}

function insertEditorHtml(editor, html) {
  restoreEditorSelection(editor);
  document.execCommand("insertHTML", false, html);
  saveEditorSelection(editor);
}

function insertEditorHtmlAtRange(editor, html, range) {
  if (range) savedEditorRange = range.cloneRange();
  insertEditorHtml(editor, html);
}

function runWithEditorRange(editor, range, callback) {
  if (range) savedEditorRange = range.cloneRange();
  restoreEditorSelection(editor);
  callback();
  saveEditorSelection(editor);
}

function editorBlockForNode(node, editor) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.("p, div, li, blockquote, h1, h2, h3") || editor;
}

function selectEditorBlock(editor, node) {
  const block = editorBlockForNode(node, editor);
  const range = document.createRange();
  range.selectNodeContents(block);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  saveEditorSelection(editor);
}

function selectEditorImage(editor, image) {
  if (!image || !editor.contains(image)) return;
  const range = document.createRange();
  range.selectNode(image);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  saveEditorSelection(editor);
}

function applyEditorCommand(editor, command, range = null) {
  runWithEditorRange(editor, range, () => document.execCommand(command, false, null));
}

function applyEditorFontSize(editor, size, range = null) {
  const safeSize = sanitizeFontSize(size);
  if (!safeSize) return;
  runWithEditorRange(editor, range, () => {
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;
    const activeRange = selection.getRangeAt(0);
    const span = document.createElement("span");
    span.style.fontSize = safeSize;
    try {
      activeRange.surroundContents(span);
    } catch {
      span.appendChild(activeRange.extractContents());
      activeRange.insertNode(span);
    }
    selection.removeAllRanges();
    const nextRange = document.createRange();
    nextRange.selectNodeContents(span);
    nextRange.collapse(false);
    selection.addRange(nextRange);
  });
}

function applyEditorLink(editor, url, range = null) {
  const href = normalizeHttpUrl(url);
  if (!href) return;
  runWithEditorRange(editor, range, () => {
    const selection = getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;
    document.execCommand("createLink", false, href);
    const anchor = selection.anchorNode?.parentElement?.closest?.("a");
    if (anchor && editor.contains(anchor)) {
      anchor.target = "_blank";
      anchor.rel = "noopener";
    }
  });
}

function applyEditorImageWidth(editor, width) {
  const safeWidth = sanitizeImageWidth(width);
  if (!safeWidth) return;
  const selection = getSelection();
  const node = selection.rangeCount ? selection.anchorNode : null;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const image = element?.closest?.("img");
  if (image && editor.contains(image)) {
    image.style.width = safeWidth;
  }
}

function editorSelectedImage(editor) {
  const selection = getSelection();
  if (!selection.rangeCount) return null;
  const node = selection.anchorNode;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const image = element?.tagName === "IMG" ? element : element?.closest?.("img");
  return image && editor.contains(image) ? image : null;
}

function shiftEditorImageWidth(editor, direction) {
  const image = editorSelectedImage(editor);
  if (!image) return;
  const current = parseInt(image.style.width || "420", 10) || 420;
  image.style.width = sanitizeImageWidth(current + direction * 40);
  saveEditorSelection(editor);
}

function shiftImageWidth(image, direction) {
  if (!image) return;
  const current = parseInt(image.style.width || "420", 10) || 420;
  image.style.width = sanitizeImageWidth(current + direction * 40);
}

function editorImageWidthValue(image) {
  return parseInt(image?.style?.width || "420", 10) || 420;
}

let editorContextMenuOpenAt = 0;
let ignoreNextEditorContextClose = false;

function hideEditorContextMenu() {
  $(".editor-context-menu")?.remove();
}

function shouldKeepFreshEditorContextMenu() {
  return Date.now() - editorContextMenuOpenAt < 220;
}

function updateEditorContextMenuState(editor, menu) {
  ["bold", "italic", "underline"].forEach((command) => {
    const button = menu.querySelector(`[data-format-command="${command}"]`);
    if (button) button.classList.toggle("active", document.queryCommandState(command));
  });
  const linkButton = menu.querySelector("[data-format-link]");
  const selection = getSelection();
  const node = selection.rangeCount ? selection.anchorNode : null;
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const anchor = element?.closest?.("a");
  linkButton?.classList.toggle("active", !!(anchor && editor.contains(anchor)));
}

function showEditorContextMenu(editor, event) {
  event.stopPropagation();
  hideEditorContextMenu();
  editorContextMenuOpenAt = Date.now();
  ignoreNextEditorContextClose = true;
  const image = event.target?.closest?.("img");
  if (image && editor.contains(image)) {
    selectEditorImage(editor, image);
  } else {
    const selection = getSelection();
    const selectedInside = selection.rangeCount && editor.contains(selection.anchorNode) && !selection.isCollapsed;
    if (!selectedInside) selectEditorBlock(editor, event.target);
  }
  const menuRange = savedEditorRange?.cloneRange() || null;
  const menuImage = image && editor.contains(image) ? image : null;
  const menu = document.createElement("div");
  menu.className = "editor-context-menu";
  const isImage = !!(image && editor.contains(image));
  menu.innerHTML = isImage ? `
    <div class="editor-context-title">图片宽度</div>
    <div class="context-stepper">
      <button type="button" data-image-step="-1"><i class="material-icons">chevron_left</i></button>
      <input data-image-width type="number" min="120" max="1200" step="10" value="${editorImageWidthValue(image)}" />
      <button type="button" data-image-step="1"><i class="material-icons">chevron_right</i></button>
    </div>
  ` : `
    <div class="editor-context-title">文字格式</div>
    <div class="context-row">
      <button type="button" data-format-command="bold"><i class="material-icons">format_bold</i></button>
      <button type="button" data-format-command="italic"><i class="material-icons">format_italic</i></button>
      <button type="button" data-format-command="underline"><i class="material-icons">format_underlined</i></button>
      <button type="button" data-format-link><i class="material-icons">link</i></button>
    </div>
    <div class="context-number-row">
      <span>字号</span>
      <input data-font-size-input type="number" min="10" max="72" step="1" value="16" />
      <button type="button" data-font-size-apply>应用</button>
    </div>
  `;
  document.body.appendChild(menu);
  if (!isImage) updateEditorContextMenuState(editor, menu);
  const left = Math.min(event.clientX, innerWidth - menu.offsetWidth - 10);
  const top = Math.min(event.clientY, innerHeight - menu.offsetHeight - 10);
  menu.style.left = `${Math.max(10, left)}px`;
  menu.style.top = `${Math.max(10, top)}px`;
  menu.addEventListener("pointerdown", (pointerEvent) => {
    pointerEvent.stopPropagation();
    if (pointerEvent.target.closest("button")) pointerEvent.preventDefault();
  });
  menu.addEventListener("mousedown", (mouseEvent) => {
    mouseEvent.stopPropagation();
    if (mouseEvent.target.closest("button")) mouseEvent.preventDefault();
  });
  menu.addEventListener("click", (clickEvent) => {
    clickEvent.stopPropagation();
    if (!clickEvent.target.closest("input")) clickEvent.preventDefault();
    const commandButton = clickEvent.target.closest("[data-format-command]");
    const fontApplyButton = clickEvent.target.closest("[data-font-size-apply]");
    const stepButton = clickEvent.target.closest("[data-image-step]");
    const linkButton = clickEvent.target.closest("[data-format-link]");
    if (commandButton) {
      applyEditorCommand(editor, commandButton.dataset.formatCommand, menuRange);
      updateEditorContextMenuState(editor, menu);
    }
    if (fontApplyButton) {
      const input = menu.querySelector("[data-font-size-input]");
      applyEditorFontSize(editor, input?.value || "", menuRange);
      updateEditorContextMenuState(editor, menu);
    }
    if (linkButton) {
      const href = prompt("输入链接地址");
      if (href) applyEditorLink(editor, href, menuRange);
      updateEditorContextMenuState(editor, menu);
    }
    if (stepButton) {
      shiftImageWidth(menuImage, Number(stepButton.dataset.imageStep));
      const input = menu.querySelector("[data-image-width]");
      if (input) input.value = editorImageWidthValue(menuImage);
    }
  });
  menu.querySelector("[data-image-width]")?.addEventListener("change", (inputEvent) => {
    if (menuImage) menuImage.style.width = sanitizeImageWidth(inputEvent.target.value);
  });
}

function currentEditorRange(editor) {
  const selection = getSelection();
  return selection.rangeCount && editor.contains(selection.anchorNode)
    ? selection.getRangeAt(0).cloneRange()
    : savedEditorRange?.cloneRange() || null;
}

async function insertEditorImages(editor, files, width = "420") {
  const images = await readImageFiles(files, 1600);
  const safeWidth = sanitizeImageWidth(width) || "420px";
  const html = images.filter(Boolean).map((image) => `<p><img src="${image}" alt="事件图片" style="width:${safeWidth}"></p>`).join("");
  if (html) insertEditorHtml(editor, html);
}

async function importRemoteEditorImage(src) {
  if (!/^https?:\/\//i.test(src)) return "";
  try {
    const result = await apiRequest("/api/uploads/import-image", {
      method: "POST",
      body: JSON.stringify({ src })
    });
    return result.src || "";
  } catch {
    return "";
  }
}

async function importPastedHtml(html = "", imageWidth = "420") {
  const template = document.createElement("template");
  template.innerHTML = html;
  const images = [...template.content.querySelectorAll("img")];
  const safeWidth = sanitizeImageWidth(imageWidth) || "420px";
  for (const image of images) {
    const src = image.getAttribute("src") || "";
    if (/^https?:\/\//i.test(src)) {
      const local = await importRemoteEditorImage(src);
      if (local) {
        image.setAttribute("src", local);
        image.style.width = safeWidth;
      } else {
        const link = document.createElement("p");
        link.textContent = src;
        image.replaceWith(link);
      }
    } else if (isAllowedImageSrc(src)) {
      image.style.width = safeWidth;
    }
  }
  return sanitizeRichHtml(template.innerHTML);
}

function bindRichEditor(editorSelector, fileInputSelector) {
  const editor = $(editorSelector);
  if (!editor) return;
  const shell = editor.closest(".editor-shell") || document;
  const fileInput = $(fileInputSelector);
  ["keyup", "mouseup", "focus", "input"].forEach((type) => {
    editor.addEventListener(type, () => saveEditorSelection(editor));
  });
  editor.addEventListener("click", (event) => {
    if (ignoreNextEditorContextClose || shouldKeepFreshEditorContextMenu()) {
      ignoreNextEditorContextClose = false;
      return;
    }
    hideEditorContextMenu();
    if (event.target?.tagName !== "IMG") return;
    selectEditorImage(editor, event.target);
  });
  editor.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    event.stopPropagation();
    showEditorContextMenu(editor, event);
  });
  [...shell.querySelectorAll("[data-editor-command]")].forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      restoreEditorSelection(editor);
      document.execCommand(button.dataset.editorCommand, false, null);
      saveEditorSelection(editor);
    });
  });
  shell.querySelector("[data-editor-image]")?.addEventListener("mousedown", (event) => event.preventDefault());
  shell.querySelector("[data-editor-image]")?.addEventListener("click", (event) => {
    event.preventDefault();
    saveEditorSelection(editor);
    fileInput?.click();
  });
  fileInput?.addEventListener("change", async () => {
    await insertEditorImages(editor, fileInput.files || [], "420");
    fileInput.value = "";
  });
  ["dragenter", "dragover"].forEach((type) => {
    editor.addEventListener(type, (event) => {
      event.preventDefault();
      editor.classList.add("drag-over");
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    editor.addEventListener(type, (event) => {
      event.preventDefault();
      editor.classList.remove("drag-over");
    });
  });
  editor.addEventListener("drop", async (event) => {
    const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
    if (files.length) {
      saveEditorSelection(editor);
      await insertEditorImages(editor, files, "420");
    }
  });
  editor.addEventListener("paste", async (event) => {
    const pasteRange = currentEditorRange(editor);
    const files = [...(event.clipboardData?.items || [])]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (files.length) {
      event.preventDefault();
      const images = await readImageFiles(files, 1600);
      const imageHtml = images.filter(Boolean).map((image) => `<p><img src="${image}" alt="事件图片" style="width:420px"></p>`).join("");
      if (imageHtml) insertEditorHtmlAtRange(editor, imageHtml, pasteRange);
      return;
    }
    const html = event.clipboardData?.getData("text/html") || "";
    if (html.trim()) {
      event.preventDefault();
      const pasted = await importPastedHtml(html, "420");
      insertEditorHtmlAtRange(editor, pasted || plainTextToHtml(event.clipboardData?.getData("text/plain") || ""), pasteRange);
      return;
    }
    const text = event.clipboardData?.getData("text/plain") || "";
    if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif)(@\S+)?(\?\S*)?$/i.test(text.trim())) {
      event.preventDefault();
      const local = await importRemoteEditorImage(text.trim());
      insertEditorHtmlAtRange(editor, local
        ? `<p><img src="${local}" alt="事件图片" style="width:420px"></p>`
        : `<p>${escapeHtml(text.trim())}</p>`, pasteRange);
      return;
    }
    if (text.trim() && /(https?:\/\/[^\s<]+|[\w.-]+\.[a-z]{2,}(?:\/[^\s<]*)?)/i.test(text)) {
      event.preventDefault();
      insertEditorHtmlAtRange(editor, plainTextToHtml(text), pasteRange);
    }
  });
}

function bindIncidentEditor() {
  bindRichEditor("#incidentEditor", "#incidentEditorImage");
}

function bindPersonBioEditor() {
  bindRichEditor("#personBioEditor", "#personBioEditorImage");
}

document.addEventListener("click", (event) => {
  if (ignoreNextEditorContextClose || shouldKeepFreshEditorContextMenu()) {
    ignoreNextEditorContextClose = false;
    return;
  }
  if (!event.target?.closest?.(".editor-context-menu")) hideEditorContextMenu();
});
document.addEventListener("scroll", () => {
  if (!shouldKeepFreshEditorContextMenu()) hideEditorContextMenu();
}, true);

function setUploadCardPreview(card, src = "") {
  if (!card) return;
  let preview = card.querySelector(".upload-preview");
  if (!preview) {
    preview = document.createElement("img");
    preview.className = "upload-preview";
    preview.alt = "已上传图片";
    card.prepend(preview);
  }
  if (src) {
    preview.src = src;
    card.classList.add("has-preview");
  } else {
    preview.removeAttribute("src");
    card.classList.remove("has-preview");
  }
}

function bindUploadCards() {
  $all(".upload-card").forEach((card) => {
    const input = card.querySelector('input[type="file"]');
    const label = card.querySelector("span");
    if (!input || !label) return;
    const refresh = () => {
      const files = [...input.files];
      if (files[0]?.type?.startsWith("image/")) {
        setUploadCardPreview(card, URL.createObjectURL(files[0]));
      } else if (card.dataset.previewSrc) {
        setUploadCardPreview(card, card.dataset.previewSrc);
      }
      label.textContent = files.length
        ? files.length === 1 ? files[0].name : `已选择 ${files.length} 张图片`
        : label.dataset.empty || "拖入图片或点击选择";
      card.classList.toggle("has-file", files.length > 0);
    };
    input.addEventListener("change", refresh);
    ["dragenter", "dragover"].forEach((type) => {
      card.addEventListener(type, (event) => {
        event.preventDefault();
        card.classList.add("drag-over");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      card.addEventListener(type, (event) => {
        event.preventDefault();
        card.classList.remove("drag-over");
      });
    });
    card.addEventListener("drop", (event) => {
      const files = [...event.dataTransfer.files].filter((file) => file.type.startsWith("image/"));
      if (!files.length) return;
      const transfer = new DataTransfer();
      if (input.multiple) {
        [...input.files, ...files].forEach((file) => transfer.items.add(file));
      } else {
        transfer.items.add(files[0]);
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    if (card.dataset.previewSrc) setUploadCardPreview(card, card.dataset.previewSrc);
    refresh();
  });
}

function bindPersonForm() {
  const form = $("#personForm");
  if (!form) return;
  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  if (needsLogin()) return;
  if (new URLSearchParams(location.search).has("id") && !isAdmin()) return;
  const editId = new URLSearchParams(location.search).get("id");
  const editingPerson = editId ? personById(editId) : null;
  if (editId && !editingPerson) {
    form.innerHTML = `<div class="empty">人物不存在</div>`;
    return;
  }
  bindPersonBioEditor();
  bindTagInput(form);
  if (editingPerson) fillPersonForm(form, editingPerson);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.submitting === "1") return;
    const submitButton = form.querySelector('[type="submit"]');
    try {
      form.dataset.submitting = "1";
      if (submitButton) submitButton.disabled = true;
      const data = new FormData(form);
      const now = new Date().toISOString();
      const avatar = await readImageFile(data.get("avatar"), 512);
      const banner = await readImageFile(data.get("banner"), 1600);
      const name = data.get("name").trim() || "未命名人物";
      const accounts = {
        qq: data.get("qq").trim(),
        bilibili: data.get("bilibili").trim(),
        douyin: data.get("douyin").trim(),
        gas: data.get("gas").trim()
      };
      const accountError = validateAccounts(accounts);
      if (accountError) {
        alert(accountError);
        form.dataset.submitting = "0";
        if (submitButton) submitButton.disabled = false;
        return;
      }
      const payload = {
        id: editingPerson?.id || createId(),
        name,
        tags: tagsFromForm(form),
        bioHtml: sanitizeRichHtml($("#personBioEditor")?.innerHTML || ""),
        bio: richTextToPlainText($("#personBioEditor")?.innerHTML || "").trim(),
        avatar: avatar || editingPerson?.avatar || "",
        banner: banner || editingPerson?.banner || "",
        status: data.get("status").trim() || "未标注",
        credibility: editingPerson?.credibility || "unverified",
        accounts,
        createdAt: editingPerson?.createdAt || now,
        updatedAt: now
      };
      if (editingPerson) {
        if (serverAvailable) {
          Object.assign(editingPerson, await apiRequest(`/api/people/${encodeURIComponent(editingPerson.id)}`, {
            method: "PUT",
            body: JSON.stringify(personPayloadForServer(payload))
          }));
        } else {
          Object.assign(editingPerson, payload);
        }
      } else {
        if (serverAvailable) {
          const result = await apiRequest("/api/people", {
            method: "POST",
            body: JSON.stringify(personPayloadForServer(payload))
          });
          if (result.pending) {
            alert("已提交，等待管理员审核。");
            location.href = "./people.html";
            return;
          }
          state.people.unshift(result);
        } else {
          state.people.unshift(payload);
        }
      }
      saveState();
      location.href = editingPerson ? `./person.html?id=${encodeURIComponent(editingPerson.id)}` : "./people.html";
    } catch (error) {
      alert(error.message);
      form.dataset.submitting = "0";
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function bindIncidentForm() {
  const form = $("#incidentForm");
  if (!form) return;
  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  if (needsLogin()) return;
  if (new URLSearchParams(location.search).has("id") && !isAdmin()) return;
  fillIncidentPersonSelect();
  const editId = new URLSearchParams(location.search).get("id");
  const editingIncident = editId ? state.incidents.find((incident) => incident.id === editId) : null;
  if (editId && !editingIncident) {
    form.innerHTML = `<div class="empty">事件不存在</div>`;
    return;
  }
  bindIncidentEditor();
  if (editingIncident) fillIncidentForm(form, editingIncident);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (form.dataset.submitting === "1") return;
    const submitButton = form.querySelector('[type="submit"]');
    try {
      form.dataset.submitting = "1";
      if (submitButton) submitButton.disabled = true;
      const data = new FormData(form);
      if (!isValidDateValue(data.get("date"))) {
        alert("日期年份必须是四位数");
        form.dataset.submitting = "0";
        if (submitButton) submitButton.disabled = false;
        return;
      }
      const contentHtml = sanitizeRichHtml($("#incidentEditor")?.innerHTML || "");
      let personIds = data.getAll("personIds").filter(Boolean);
      if (!personIds.length && isAdmin()) {
        const personId = createId();
        const now = new Date().toISOString();
        state.people.unshift({
          id: personId,
          name: "未归档人物",
          tags: [],
          bio: "",
          avatar: "",
          banner: "",
          status: "controversial",
          credibility: "unverified",
          accounts: { qq: "", bilibili: "", douyin: "", gas: "" },
          createdAt: now,
          updatedAt: now
        });
        personIds = [personId];
      }
      const payload = {
        id: editingIncident?.id || createId(),
        personId: personIds[0] || "",
        personIds,
        title: data.get("title").trim() || "未命名事件",
        date: data.get("date") || new Date().toISOString().slice(0, 10),
        category: data.get("category").trim() || "未标注",
        detail: incidentPlainText({ contentHtml }).trim(),
        evidence: "",
        contentHtml,
        images: [],
        result: data.get("result").trim(),
        pinned: isAdmin() && data.get("pinned") === "on",
        recommended: isAdmin() && data.get("recommended") === "on",
        credibility: editingIncident?.credibility || "unverified",
        createdAt: editingIncident?.createdAt || new Date().toISOString()
      };
      if (editingIncident) {
        if (serverAvailable) {
          Object.assign(editingIncident, await apiRequest(`/api/incidents/${encodeURIComponent(editingIncident.id)}`, {
            method: "PUT",
            body: JSON.stringify(incidentPayloadForServer(payload))
          }));
        } else {
          Object.assign(editingIncident, payload);
        }
      } else {
        if (serverAvailable) {
          const result = await apiRequest("/api/incidents", {
            method: "POST",
            body: JSON.stringify(incidentPayloadForServer(payload))
          });
          if (result.pending) {
            alert("已提交，等待管理员审核。");
            location.href = "./incidents.html";
            return;
          }
          state.incidents.unshift(result);
        } else {
          state.incidents.unshift(payload);
        }
      }
      personIds.map(personById).filter(Boolean).forEach((person) => {
        person.updatedAt = new Date().toISOString();
      });
      saveState();
      location.href = personIds[0] ? `./person.html?id=${encodeURIComponent(personIds[0])}` : "./incidents.html";
    } catch (error) {
      alert(error.message);
      form.dataset.submitting = "0";
      if (submitButton) submitButton.disabled = false;
    }
  });
}

function renderPersonDetail() {
  const root = $("#personDetail");
  if (!root) return;
  const id = new URLSearchParams(location.search).get("id");
  const person = personById(id);
  if (!person) {
    root.innerHTML = `<div class="empty">人物不存在</div>`;
    return;
  }
  document.title = `${person.name} - DLRS 人物志`;
  const accounts = person.accounts || {};
  const incidents = incidentsForPerson(person.id).sort(compareIncidents);
  root.innerHTML = `
    <section class="space-head br8">
      <div class="space-banner"${imageStyle(person.banner || "./uploads/default-banner.jpg")}></div>
      ${isAdmin() ? `
        <div class="space-actions">
          <a class="space-edit a" href="./edit-person.html?id=${encodeURIComponent(person.id)}">编辑人物</a>
          <button class="space-delete" type="button" data-delete-person="${escapeHtml(person.id)}">删除人物</button>
        </div>
      ` : ""}
      <div class="space-profile">
        <div class="space-avatar">${person.avatar ? `<img src="${person.avatar}" alt="${escapeHtml(person.name)}头像" />` : escapeHtml(person.name.slice(0, 1))}</div>
        <div>
          <h1>${escapeHtml(person.name)}</h1>
          <p>${escapeHtml(statusText(person.status))}</p>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="detail-grid">
        <div class="box2 br8 detail-panel">
          <div class="section-title app-title"><h2>档案概览</h2></div>
          <div class="tags">
            <span class="tag">${escapeHtml(statusText(person.status))}</span>
            ${(person.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="incident-content person-bio-content">${personBioHtml(person) || `<p>暂无简介</p>`}</div>
          ${auditMeta(person)}
          ${historyList(person)}
        </div>
        <div class="box2 br8 detail-panel">
          <div class="section-title app-title"><h2>社交账号</h2></div>
          <div class="account-list">
            ${accountRow("QQ", accounts.qq, "qq")}
            ${accountRow("Bilibili", accounts.bilibili, "bilibili")}
            ${accountRow("抖音", accounts.douyin, "douyin")}
            ${accountRow("GAS", accounts.gas, "gas")}
          </div>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="section-title app-title">
        <h2>事件时间线</h2>
        <a class="a" href="./add-incident.html?personId=${encodeURIComponent(person.id)}">添加事件</a>
      </div>
      <div class="timeline">${incidents.length ? incidents.map(incidentItem).join("") : `<div class="empty">暂无事件记录</div>`}</div>
    </section>
  `;
  bindDeleteButtons();
}

function accountRow(label, value, className) {
  const href = className === "qq"
    ? value ? qqProfileLink(value) : ""
    : className === "gas"
      ? value ? gasProfileLink(value) : ""
    : value || "";
  const shortValue = className === "bilibili" && value ? value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : value;
  const sizeClass = String(shortValue || "").length > 42 ? " tiny" : String(shortValue || "").length > 24 ? " compact" : "";
  const link = href
    ? `<a class="account-link${sizeClass}" href="${escapeHtml(href)}" title="${escapeHtml(value)}" ${className === "qq" || className === "gas" ? "" : 'target="_blank" rel="noopener"'}>${escapeHtml(shortValue || "打开")}</a>`
    : `<span class="account-empty">未收录</span>`;
  return `
    <div class="account-row">
      <span class="account-pill ${className}">${escapeHtml(label)}</span>
      <b>${link}</b>
    </div>
  `;
}

function reviewField(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return `
    <div class="review-field">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(text)}</b>
    </div>
  `;
}

function reviewPersonNames(payload) {
  const ids = incidentPersonIds(payload);
  const names = ids.map((id) => personById(id)?.name || "").filter(Boolean);
  if (Array.isArray(payload.people)) {
    payload.people.forEach((person) => {
      if (person?.name) names.push(person.name);
    });
  }
  return [...new Set(names)].join("、") || "未关联人物";
}

function reviewPersonSummary(payload) {
  const accounts = payload.accounts || {};
  const avatar = payload.avatar || "";
  const banner = payload.banner || "";
  const tags = Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : [];
  return `
    <div class="review-detail">
      <div class="review-person-head">
        <div class="review-avatar"${imageStyle(avatar)}>${avatar ? "" : escapeHtml((payload.name || "?").slice(0, 1))}</div>
        <div>
          <h4>${escapeHtml(payload.name || "未命名人物")}</h4>
          <div class="review-status"><span class="tag pending">待审核</span>${payload.status ? `<span class="tag">${escapeHtml(payload.status)}</span>` : ""}</div>
        </div>
      </div>
      ${banner ? `<div class="review-banner"${imageStyle(banner)}></div>` : ""}
      <div class="review-fields">
        ${reviewField("人物类型", payload.status)}
        ${tags.length ? reviewField("标签", tags.join("、")) : ""}
      </div>
      <div class="account-list review-accounts">
        ${accountRow("QQ", accounts.qq, "qq")}
        ${accountRow("Bilibili", accounts.bilibili, "bilibili")}
        ${accountRow("抖音", accounts.douyin, "douyin")}
        ${accountRow("GAS", accounts.gas, "gas")}
      </div>
      <div class="review-section-title">个人简介</div>
      <div class="incident-content person-bio-content">${personBioHtml(payload) || `<p>暂无简介</p>`}</div>
    </div>
  `;
}

function reviewIncidentSummary(payload) {
  return `
    <div class="review-detail">
      <div class="review-title-row">
        <h4>${escapeHtml(payload.title || "未命名事件")}</h4>
        <div class="incident-flags"><span class="tag pending">待审核</span>${incidentFlags(payload)}</div>
      </div>
      <div class="review-fields">
        ${reviewField("发生日期", payload.date || "未填写日期")}
        ${reviewField("事件类型", payload.category || "未标注")}
        ${reviewField("关联人物", reviewPersonNames(payload))}
        ${reviewField("处理结果", payload.result)}
      </div>
      <div class="review-section-title">事件正文</div>
      <div class="incident-content">${legacyIncidentHtml(payload) || `<p>暂无描述</p>`}</div>
    </div>
  `;
}

function bindLoginForm() {
  const form = $("#loginForm");
  if (!form) return;
  if (currentUser) {
    location.href = currentUser.mustChangePassword ? "./change-password.html" : "./settings.html";
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    try {
      const result = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          qq: data.get("qq").trim(),
          password: data.get("password")
        })
      });
      currentUser = result.me;
      const next = new URLSearchParams(location.search).get("next") || "settings.html";
      const target = next.startsWith("./") ? next.slice(2) : next;
      location.href = currentUser.mustChangePassword ? "./change-password.html" : `./${target}`;
    } catch (error) {
      $("#loginMessage").textContent = error.message;
    }
  });
}

function bindPasswordForm() {
  const form = $("#passwordForm");
  if (!form) return;
  if (!currentUser) {
    location.href = "./login.html";
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    if (data.get("newPassword") !== data.get("confirmPassword")) {
      $("#passwordMessage").textContent = "两次输入的新密码不一致";
      return;
    }
    try {
      const result = await apiRequest("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          oldPassword: data.get("oldPassword"),
          newPassword: data.get("newPassword")
        })
      });
      currentUser = result.me;
      location.href = "./settings.html";
    } catch (error) {
      $("#passwordMessage").textContent = error.message;
    }
  });
}

function bindLogout() {
  $("#logoutButton")?.addEventListener("click", async () => {
    await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {});
    currentUser = null;
    location.href = "./login.html";
  });
}

function renderAccountPanel() {
  const root = $("#accountPanel");
  if (!root) return;
  if (!currentUser) {
    root.innerHTML = `
      <div class="auth-card">
        <h3>未登录</h3>
        <p>账号需要通过 QQ Bot 指令注册。</p>
        <a class="primary-button inline-button" href="./login.html">登录</a>
      </div>
    `;
    return;
  }
  root.innerHTML = `
    <div class="auth-card">
      <div class="profile-head">
        <div class="profile-avatar">${currentUser.avatar ? `<img src="${escapeHtml(currentUser.avatar)}" alt="头像" />` : escapeHtml((currentUser.username || currentUser.qq).slice(0, 1))}</div>
        <div>
          <h3>${escapeHtml(currentUser.username || currentUser.qq)}</h3>
          <p>${escapeHtml(currentUser.qq)} · ${escapeHtml(roleText(currentUser.role))}${currentUser.mustChangePassword ? " · 需要修改初始密码" : ""}</p>
        </div>
      </div>
      <p><a class="a" href="${qqProfileLink(currentUser.qq)}">个人主页</a></p>
      <div class="button-row">
        <a class="top-action" href="./change-password.html"><i class="material-icons">password</i>修改密码</a>
        ${isAdmin() ? `<a class="top-action" href="./admin.html"><i class="material-icons">verified_user</i>审核</a>` : ""}
        ${isSuperAdmin() ? `<a class="top-action" href="./users.html"><i class="material-icons">manage_accounts</i>用户</a>` : ""}
        <button id="logoutButton" class="top-action danger" type="button"><i class="material-icons">logout</i>退出</button>
      </div>
    </div>
    <form id="profileForm" class="auth-card">
      <h3>个人资料</h3>
      <label>用户名<input name="username" value="${escapeHtml(currentUser.username || "")}" placeholder="显示名称" /></label>
      <label class="upload-card wide" data-preview-src="${escapeHtml(currentUser.avatar || "")}"><input name="profileAvatar" type="file" accept="image/*" /><i class="material-icons">account_circle</i><b>头像</b><span data-empty="拖入图片或点击选择">拖入图片或点击选择</span></label>
      <p id="profileMessage" class="form-message"></p>
      <button class="primary-button" type="submit">保存个人资料</button>
    </form>
  `;
  bindLogout();
  bindUploadCards();
  bindProfileForm();
}

function bindProfileForm() {
  const form = $("#profileForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const avatar = await readImageFile(data.get("profileAvatar"), 512);
    try {
      const result = await apiRequest("/api/me/profile", {
        method: "PUT",
        body: JSON.stringify(profilePayloadForServer({
          username: data.get("username").trim(),
          avatar
        }))
      });
      currentUser = result.me;
      await loadServerState();
      renderAccountPanel();
    } catch (error) {
      $("#profileMessage").textContent = error.message;
    }
  });
}

function submissionSummary(submission) {
  const payload = submission.payload || {};
  if (submission.type === "person") {
    return reviewPersonSummary(payload);
  }
  return reviewIncidentSummary(payload);
}

async function renderAdminPage() {
  const root = $("#adminSubmissions");
  if (!root) return;
  if (!isAdmin()) {
    root.innerHTML = `<div class="empty">需要管理员权限</div>`;
    return;
  }
  try {
    const data = await apiRequest("/api/admin/submissions");
    const submissions = data.submissions || [];
    const pending = submissions.filter((item) => item.status === "pending");
    root.innerHTML = pending.length ? pending.map((item) => `
      <article class="timeline-item review-item" data-submission-id="${item.id}">
        <div class="timeline-head">
          <h3>${item.type === "person" ? "人物提交" : "事件提交"}</h3>
          <span class="tag pending">待审核</span>
          <span class="tag">QQ ${escapeHtml(item.submitterQq)}</span>
        </div>
        <p>${escapeHtml(item.createdAt || "")}</p>
        ${submissionSummary(item)}
        <div class="button-row">
          <button class="top-action approve-button" type="button" data-action="approve">通过</button>
          <button class="top-action danger reject-button" type="button" data-action="reject">拒绝</button>
        </div>
      </article>
    `).join("") : `<div class="empty">暂无待审核内容</div>`;
    $all("[data-submission-id] button[data-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const item = button.closest("[data-submission-id]");
        await apiRequest(`/api/admin/submissions/${encodeURIComponent(item.dataset.submissionId)}/${button.dataset.action}`, { method: "POST" });
        await loadServerState();
        await renderAdminPage();
      });
    });
  } catch (error) {
    root.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

async function renderAdminUsers() {
  const root = $("#adminUsers");
  if (!root) return;
  if (!isSuperAdmin()) {
    root.innerHTML = `<div class="empty">需要超级管理员权限</div>`;
    return;
  }
  try {
    const data = await apiRequest("/api/admin/users");
    const users = data.users || [];
    root.innerHTML = users.length ? users.map((user) => `
      <article class="timeline-item user-row" data-user-qq="${escapeHtml(user.qq)}">
        <div class="timeline-head">
          <div class="profile-head compact">
            <div class="profile-avatar small">${user.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="头像" />` : escapeHtml((user.username || user.qq).slice(0, 1))}</div>
            <div>
              <h3><a class="a" href="${qqProfileLink(user.qq)}">${escapeHtml(user.username || user.qq)}</a></h3>
              <p>${escapeHtml(user.qq)}</p>
            </div>
          </div>
          <span class="tag">${escapeHtml(roleText(user.role))}</span>
        </div>
        <p>${escapeHtml(user.createdAt || "")}${user.mustChangePassword ? " · 未修改初始密码" : ""}</p>
        <label class="role-switch">权限
          <select data-role-select>
            <option value="user" ${user.role === "user" ? "selected" : ""}>普通用户</option>
            <option value="admin" ${user.role === "admin" ? "selected" : ""}>管理员</option>
            <option value="superadmin" ${user.role === "superadmin" ? "selected" : ""}>超级管理员</option>
          </select>
        </label>
      </article>
    `).join("") : `<div class="empty">暂无用户</div>`;
    $all("[data-user-qq] [data-role-select]").forEach((select) => {
      select.addEventListener("change", async () => {
        const row = select.closest("[data-user-qq]");
        select.disabled = true;
        await apiRequest(`/api/admin/users/${encodeURIComponent(row.dataset.userQq)}`, {
          method: "PUT",
          body: JSON.stringify({ role: select.value })
        });
        await loadServerState();
        applyAuthUi();
        await renderAdminUsers();
      });
    });
  } catch (error) {
    root.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

function bindSettings() {
  const toggle = $("#themeToggle");
  if (toggle) toggle.addEventListener("change", () => {
    const theme = toggle.checked ? "light" : "dark";
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
  });
  renderAccountPanel();
}

function redirectToLogin(nextPath) {
  const target = nextPath || `${location.pathname.split("/").pop() || "index.html"}${location.search}`;
  location.href = `./login.html?next=${encodeURIComponent(target)}`;
}

function bindProtectedLinks() {
  const current = location.pathname.split("/").pop() || "index.html";
  const addPages = new Set(["add.html", "add-person.html", "add-incident.html"]);
  const editPages = new Set(["edit-person.html", "edit-incident.html"]);
  const protectedSelectors = [
    'a[href="./add-person.html"]',
    'a[href="./add.html"]',
    'a[href="./add-incident.html"]',
    'a[href="./edit-person.html"]',
    'a[href="./edit-incident.html"]',
    'a[href="./admin.html"]',
    'a[href="./users.html"]'
  ];
  $all(protectedSelectors.join(",")).forEach((link) => {
    const href = link.getAttribute("href") || "";
    const target = href.replace(/^\.\//, "");
    link.addEventListener("click", (event) => {
      const targetPage = target.split("?")[0];
      if ((addPages.has(targetPage) || editPages.has(targetPage) || targetPage === "admin.html" || targetPage === "users.html") && !currentUser) {
        event.preventDefault();
        alert("请先登录后再使用该功能。");
        redirectToLogin(`${targetPage}${href.includes("?") ? href.slice(href.indexOf("?")) : ""}`);
        return;
      }
      if ((editPages.has(targetPage) || targetPage === "admin.html") && !isAdmin()) {
        event.preventDefault();
        alert("只有管理员可以使用这个功能。");
        return;
      }
      if (targetPage === "users.html" && !isSuperAdmin()) {
        event.preventDefault();
        alert("只有超级管理员可以使用这个功能。");
        return;
      }
      if (addPages.has(targetPage) && currentUser?.mustChangePassword) {
        event.preventDefault();
        location.href = "./change-password.html";
      }
    }, { capture: true });
  });
  if (!currentUser) {
    $all('a[href="./add-person.html"], a[href="./add-incident.html"]').forEach((link) => {
      link.title = "登录后才能使用";
    });
  }
}

function bindQqLinks() {
  $all("[data-qq-link]").forEach((link) => {
    const qq = link.dataset.qqLink || link.textContent || "";
    link.href = qqProfileLink(qq);
  });
}

function bindDeleteButtons() {
  $all("[data-delete-person]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("确认删除这个人物？该人物名下事件也会一起删除。")) return;
      try {
        await apiRequest(`/api/people/${encodeURIComponent(button.dataset.deletePerson)}`, { method: "DELETE" });
        await loadServerState();
        location.href = "./people.html";
      } catch (error) {
        alert(error.message);
      }
    });
  });
  $all("[data-delete-incident]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("确认删除这条事件？")) return;
      try {
        await apiRequest(`/api/incidents/${encodeURIComponent(button.dataset.deleteIncident)}`, { method: "DELETE" });
        await loadServerState();
        const item = button.closest("[data-incident-id]");
        if (item) item.remove();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

function bindMenu() {
  if (sessionStorage.getItem(NAV_KEY) === "1") document.body.classList.add("nav-open");
  document.documentElement.classList.remove("nav-open-initial");
  $("#menuButton")?.addEventListener("click", () => {
    document.body.classList.toggle("nav-open");
    sessionStorage.setItem(NAV_KEY, document.body.classList.contains("nav-open") ? "1" : "0");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      document.body.classList.remove("nav-open");
      sessionStorage.setItem(NAV_KEY, "0");
    }
  });
  const current = location.pathname.split("/").pop() || "index.html";
  $all(".nav a").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const active = href.endsWith(current)
      || (current === "edit-person.html" && href.endsWith("people.html"))
      || ((current === "edit-incident.html" || current === "incident.html") && href.endsWith("incidents.html"))
      || (current === "users.html" && href.endsWith("users.html"));
    link.classList.toggle("active", active);
  });
}

function mobileTabItems() {
  return [
    { href: "./index.html", icon: "home", label: "首页", match: ["index.html", ""] },
    { href: "./people.html", icon: "people", label: "人物", match: ["people.html", "person.html", "edit-person.html"] },
    { href: "./incidents.html", icon: "view_list", label: "事件", match: ["incidents.html", "incident.html", "edit-incident.html"] },
    { href: "./add.html", icon: "add_circle", label: "添加", match: ["add.html", "add-person.html", "add-incident.html"] },
    { href: "./settings.html", icon: "person", label: "我的", match: ["settings.html", "users.html"] }
  ];
}

function bindMobileTabbar() {
  const current = location.pathname.split("/").pop() || "index.html";
  const tabbar = document.createElement("nav");
  tabbar.className = "mobile-tabbar";
  tabbar.innerHTML = mobileTabItems().map((item) => {
    const active = item.match.includes(current);
    return `
      <a class="mobile-tabbar__item ${active ? "active" : ""}" href="${item.href}">
        <i class="material-icons">${item.icon}</i>
        <span>${item.label}</span>
      </a>
    `;
  }).join("");
  document.body.appendChild(tabbar);
}

async function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || "dark");
  await loadServerState();
  applyAuthUi();
  if (!guardRestrictedPages()) return;
  bindMenu();
  bindMobileTabbar();
  bindQqLinks();
  bindCardNavigation();
  bindUploadCards();
  renderHome();
  renderPeoplePage();
  renderIncidentsPage();
  bindDeleteButtons();
  bindPersonForm();
  bindIncidentForm();
  renderPersonDetail();
  renderIncidentDetail();
  bindProtectedLinks();
  bindLoginForm();
  bindPasswordForm();
  await renderAdminPage();
  await renderAdminUsers();
  bindSettings();
}

init();
