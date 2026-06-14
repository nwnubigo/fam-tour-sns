/**
 * 로컬 테스트 서버 v2 — Apps Script(doPost) 의 submit/lookup/update 액션을 동일하게 구현.
 *
 *   실행:    node server.js
 *   브라우저: http://localhost:3000          (등록)
 *            http://localhost:3000/view.html  (조회/수정)
 *            http://localhost:3000/view       (저장된 전체 데이터 표)
 *            http://localhost:3000/report     (컨텐츠별 집계)
 *            http://localhost:3000/data       (CSV 다운로드)
 *
 * 의존성 없음 — Node.js 내장 모듈만 사용.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data.csv");
const PASSWORD_PEPPER = "fam-tour-2026-rural";  // Code.gs 와 동일해야 함
const HEADERS = [
  "submission_id","timestamp","name","sns_url",
  "category","content_item","view_count","password_hash"
];

function ensureCsv() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "﻿" + HEADERS.join(",") + "\n", "utf8");
    return;
  }
  // 마이그레이션: 헤더에 password_hash 가 없으면 컬럼 추가
  const text = fs.readFileSync(DATA_FILE, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return;
  const header = parseCsvLine(lines[0]);
  if (header.length < 8 || header[7] !== "password_hash") {
    const newLines = [HEADERS.join(",")];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) continue;
      const cols = parseCsvLine(lines[i]);
      while (cols.length < 8) cols.push("");
      newLines.push(cols.map(csvEscape).join(","));
    }
    fs.writeFileSync(DATA_FILE, "﻿" + newLines.join("\n") + "\n", "utf8");
  }
}
ensureCsv();

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readData() {
  ensureCsv();
  const text = fs.readFileSync(DATA_FILE, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { header: HEADERS, rows: [] };
  const rows = lines.slice(1).map(parseCsvLine);
  return { header: parseCsvLine(lines[0]), rows };
}

function writeAllRows(rows) {
  const lines = [HEADERS.join(",")];
  rows.forEach(r => {
    while (r.length < 8) r.push("");
    lines.push(r.map(csvEscape).join(","));
  });
  fs.writeFileSync(DATA_FILE, "﻿" + lines.join("\n") + "\n", "utf8");
}

function hashPassword(pw) {
  return crypto.createHash("sha256").update(PASSWORD_PEPPER + pw, "utf8").digest("hex");
}

function buildRows(submissionId, timestamp, name, urls, pwHash) {
  const rows = [];
  urls.forEach(entry => {
    const url = (entry.url || "").toString().trim();
    const contents = Array.isArray(entry.contents) ? entry.contents : [];
    if (!url || contents.length === 0) return;
    contents.forEach(c => {
      rows.push([
        submissionId, timestamp, name, url,
        c.category || "", c.item || "",
        String(Number(c.view_count) || 0),
        pwHash
      ]);
    });
  });
  return rows;
}

/* ---------- 액션 ---------- */

function actionSubmit(payload) {
  const name = (payload.name || "").toString().trim();
  const password = (payload.password || "").toString();
  const urls = Array.isArray(payload.urls) ? payload.urls : [];
  if (!name) return { success: false, error: "이름이 비어 있습니다." };
  if (!password) return { success: false, error: "비밀번호가 비어 있습니다." };
  if (urls.length === 0) return { success: false, error: "URL 데이터가 없습니다." };

  const submissionId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const rows = buildRows(submissionId, timestamp, name, urls, hashPassword(password));
  if (rows.length === 0) return { success: false, error: "유효한 데이터가 없습니다." };

  ensureCsv();
  fs.appendFileSync(DATA_FILE, rows.map(r => r.map(csvEscape).join(",")).join("\n") + "\n", "utf8");
  return { success: true, count: rows.length, submission_id: submissionId };
}

function actionLookup(payload) {
  const name = (payload.name || "").toString().trim();
  const password = (payload.password || "").toString();
  if (!name || !password) return { success: false, error: "이름과 비밀번호를 입력하세요." };
  const pwHash = hashPassword(password);
  const { rows } = readData();
  const matched = rows.filter(r => r[2] === name && r[7] === pwHash);
  if (matched.length === 0) return { success: false, error: "이름 또는 비밀번호가 일치하지 않습니다." };
  const byUrl = new Map();
  matched.forEach(r => {
    const url = r[3];
    if (!byUrl.has(url)) byUrl.set(url, { url, contents: [] });
    byUrl.get(url).contents.push({
      category: r[4],
      item: r[5],
      view_count: Number(r[6]) || 0
    });
  });
  return { success: true, urls: Array.from(byUrl.values()) };
}

function actionUpdate(payload) {
  const name = (payload.name || "").toString().trim();
  const password = (payload.password || "").toString();
  const urls = Array.isArray(payload.urls) ? payload.urls : [];
  if (!name || !password) return { success: false, error: "이름과 비밀번호를 입력하세요." };
  const pwHash = hashPassword(password);
  const { rows } = readData();
  const keep = [], removed = [];
  rows.forEach(r => {
    if (r[2] === name && r[7] === pwHash) removed.push(r);
    else keep.push(r);
  });
  if (removed.length === 0) return { success: false, error: "이름 또는 비밀번호가 일치하지 않습니다." };
  let submissionId = null, inserted = 0;
  if (urls.length > 0) {
    submissionId = crypto.randomUUID();
    const newRows = buildRows(submissionId, new Date().toISOString(), name, urls, pwHash);
    inserted = newRows.length;
    keep.push(...newRows);
  }
  writeAllRows(keep);
  return { success: true, deleted: removed.length, inserted, submission_id: submissionId };
}

/* ---------- HTTP 핸들러 ---------- */

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
function send(res, code, contentType, body) {
  res.writeHead(code, { "Content-Type": contentType });
  res.end(body);
}
function htmlEscape(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
function renderTable(title, header, rows) {
  const th = header.map(h => `<th>${htmlEscape(h)}</th>`).join("");
  const tr = rows.map(r => "<tr>" + r.map(c => `<td>${htmlEscape(c)}</td>`).join("") + "</tr>").join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${htmlEscape(title)}</title>
<style>
  body{font-family:-apple-system,"Segoe UI","Malgun Gothic",sans-serif;background:#f3f6f2;margin:0;padding:24px;color:#1f2d1f;}
  h1{color:#2d7a3e;margin:0 0 8px;}
  .meta{color:#5a6b5a;margin-bottom:18px;font-size:0.9rem;}
  .nav a{margin-right:12px;color:#2d7a3e;text-decoration:none;font-weight:600;}
  .nav{margin-bottom:16px;}
  table{border-collapse:collapse;background:#fff;width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-radius:8px;overflow:hidden;}
  th{background:#2d7a3e;color:#fff;padding:10px 12px;text-align:left;font-size:0.85rem;position:sticky;top:0;}
  td{padding:9px 12px;border-bottom:1px solid #eef2ee;font-size:0.85rem;word-break:break-all;font-family:monospace;}
  tr:hover td{background:#f7faf7;}
  .empty{padding:32px;text-align:center;color:#888;background:#fff;border-radius:8px;}
</style></head><body>
<h1>${htmlEscape(title)}</h1>
<div class="meta">${rows.length} 건 · ${new Date().toLocaleString("ko-KR")}</div>
<div class="nav">
  <a href="/">← 등록 폼</a>
  <a href="/view.html">조회/수정</a>
  <a href="/view">전체 데이터</a>
  <a href="/report">컨텐츠별 집계</a>
  <a href="/data">CSV 다운로드</a>
</div>
${rows.length === 0 ? `<div class="empty">아직 저장된 데이터가 없습니다.</div>`
  : `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`}
</body></html>`;
}

function serveStatic(res, file) {
  fs.readFile(path.join(ROOT, file), (err, data) => {
    if (err) return send(res, 404, "text/plain; charset=utf-8", "Not Found: " + file);
    const ext = path.extname(file).toLowerCase();
    const ct = ext === ".html" ? "text/html; charset=utf-8"
             : ext === ".js"   ? "application/javascript; charset=utf-8"
             : ext === ".css"  ? "text/css; charset=utf-8"
             : "application/octet-stream";
    send(res, 200, ct, data);
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  const url = req.url.split("?")[0];

  if (req.method === "GET") {
    if (url === "/" || url === "/index.html") return serveStatic(res, "index.html");
    if (url === "/view.html") return serveStatic(res, "view.html");
    if (url === "/data") {
      fs.readFile(DATA_FILE, (err, data) => {
        if (err) return send(res, 500, "text/plain", "no data");
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="data.csv"'
        });
        res.end(data);
      });
      return;
    }
    if (url === "/view") {
      const { header, rows } = readData();
      return send(res, 200, "text/html; charset=utf-8", renderTable("저장된 데이터 (Submissions)", header, rows));
    }
    if (url === "/report") {
      const { rows } = readData();
      const agg = new Map();
      rows.forEach(r => {
        const key = r[4] + "||" + r[5];
        if (!agg.has(key)) agg.set(key, { cat: r[4], item: r[5], posts: 0, viewSum: 0, names: new Set() });
        const a = agg.get(key);
        a.posts++; a.viewSum += Number(r[6]) || 0; a.names.add(r[2]);
      });
      const aggRows = Array.from(agg.values())
        .sort((a,b) => a.cat.localeCompare(b.cat,"ko") || b.posts - a.posts)
        .map(a => [a.cat, a.item, a.posts, a.names.size, a.viewSum]);
      return send(res, 200, "text/html; charset=utf-8",
        renderTable("컨텐츠별 집계 보고서",
          ["category","content_item","게시물 수","참여자 수","조회수 합"], aggRows));
    }
  }

  if (req.method === "POST" && url === "/submit") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const action = payload.action || "submit";
        let result;
        if (action === "submit") result = actionSubmit(payload);
        else if (action === "lookup") result = actionLookup(payload);
        else if (action === "update") result = actionUpdate(payload);
        else result = { success: false, error: "알 수 없는 요청: " + action };
        console.log(`[${new Date().toISOString()}] ${action} ${payload.name || ""} -> ${result.success ? "OK" : "FAIL: " + result.error}`);
        json(res, 200, result);
      } catch (err) {
        json(res, 200, { success: false, error: err.message });
      }
    });
    return;
  }

  send(res, 404, "text/plain; charset=utf-8", "Not Found");
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ✓ 로컬 테스트 서버 v2 실행 중");
  console.log("  ────────────────────────────────────────");
  console.log(`  등록 폼      :  http://localhost:${PORT}/`);
  console.log(`  조회/수정    :  http://localhost:${PORT}/view.html`);
  console.log(`  전체 데이터  :  http://localhost:${PORT}/view`);
  console.log(`  집계 보고서  :  http://localhost:${PORT}/report`);
  console.log(`  CSV 다운로드 :  http://localhost:${PORT}/data`);
  console.log("  ────────────────────────────────────────");
  console.log("");
});
