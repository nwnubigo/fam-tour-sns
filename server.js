/**
 * 로컬 테스트 서버 — Google Apps Script(doPost) 동작을 흉내냅니다.
 *
 *   실행:  node server.js
 *   접속:  http://localhost:3000
 *   데이터: data.csv  (이 폴더에 자동 생성/누적)
 *   확인:  http://localhost:3000/view     (저장된 데이터 HTML 표)
 *          http://localhost:3000/data     (CSV 다운로드)
 *          http://localhost:3000/report   (컨텐츠별 집계 표)
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
const INDEX_FILE = path.join(ROOT, "index.html");
const HEADERS = ["submission_id","timestamp","name","sns_url","category","content_item","view_count"];

// CSV 보장 (UTF-8 BOM 포함 → Excel 한글 호환). 매 호출 시점에 파일 존재 검사.
function ensureCsv() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, "﻿" + HEADERS.join(",") + "\n", "utf8");
  }
}
ensureCsv();

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[,"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function parseCsv(text) {
  // 간단 파서 — 우리가 직접 만든 CSV 만 다루므로 충분
  const noBom = text.replace(/^﻿/, "");
  const lines = noBom.split(/\r?\n/).filter(l => l.length > 0);
  return lines.map(line => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") { out.push(cur); cur = ""; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out;
  });
}

function readData() {
  ensureCsv();
  const text = fs.readFileSync(DATA_FILE, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return { header: HEADERS, rows: [] };
  return { header: rows[0], rows: rows.slice(1) };
}

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

function renderTable(title, header, rows, extra = "") {
  const th = header.map(h => `<th>${htmlEscape(h)}</th>`).join("");
  const tr = rows.map(r => "<tr>" + r.map(c => `<td>${htmlEscape(c)}</td>`).join("") + "</tr>").join("");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${htmlEscape(title)}</title>
<style>
  body{font-family:-apple-system,"Segoe UI","Malgun Gothic",sans-serif;background:#f3f6f2;margin:0;padding:24px;color:#1f2d1f;}
  h1{color:#2d7a3e;margin:0 0 8px;}
  .meta{color:#5a6b5a;margin-bottom:18px;font-size:0.9rem;}
  .nav a{margin-right:12px;color:#2d7a3e;text-decoration:none;font-weight:600;}
  .nav{margin-bottom:16px;}
  table{border-collapse:collapse;background:#fff;width:100%;box-shadow:0 1px 3px rgba(0,0,0,0.06);border-radius:8px;overflow:hidden;}
  th{background:#2d7a3e;color:#fff;padding:10px 12px;text-align:left;font-size:0.88rem;position:sticky;top:0;}
  td{padding:9px 12px;border-bottom:1px solid #eef2ee;font-size:0.88rem;vertical-align:top;word-break:break-all;}
  tr:hover td{background:#f7faf7;}
  .empty{padding:32px;text-align:center;color:#888;background:#fff;border-radius:8px;}
</style></head><body>
<h1>${htmlEscape(title)}</h1>
<div class="meta">${rows.length} 건 · ${new Date().toLocaleString("ko-KR")}</div>
<div class="nav">
  <a href="/">← 입력 폼</a>
  <a href="/view">전체 데이터</a>
  <a href="/report">컨텐츠별 집계</a>
  <a href="/data">CSV 다운로드</a>
</div>
${extra}
${rows.length === 0
  ? `<div class="empty">아직 저장된 데이터가 없습니다.</div>`
  : `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`}
</body></html>`;
}

const server = http.createServer((req, res) => {
  // 같은 출처에서 동작하므로 CORS 는 사실상 불필요하지만 안전하게 허용
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const url = req.url.split("?")[0];

  // 정적 페이지
  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    fs.readFile(INDEX_FILE, (err, data) => {
      if (err) return send(res, 500, "text/plain; charset=utf-8", "index.html 로딩 실패");
      send(res, 200, "text/html; charset=utf-8", data);
    });
    return;
  }

  // CSV 다운로드
  if (req.method === "GET" && url === "/data") {
    fs.readFile(DATA_FILE, (err, data) => {
      if (err) return send(res, 500, "text/plain; charset=utf-8", "데이터 없음");
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="data.csv"'
      });
      res.end(data);
    });
    return;
  }

  // 전체 데이터 표
  if (req.method === "GET" && url === "/view") {
    const { header, rows } = readData();
    send(res, 200, "text/html; charset=utf-8", renderTable("저장된 데이터 (Submissions)", header, rows));
    return;
  }

  // 컨텐츠별 집계
  if (req.method === "GET" && url === "/report") {
    const { rows } = readData();
    const agg = new Map();
    rows.forEach(r => {
      // [submission_id, timestamp, name, sns_url, category, content_item, view_count]
      const cat = r[4], item = r[5];
      const view = Number(r[6]) || 0;
      const key = cat + "||" + item;
      if (!agg.has(key)) agg.set(key, { cat, item, posts: 0, viewSum: 0, names: new Set() });
      const a = agg.get(key);
      a.posts += 1;
      a.viewSum += view;
      a.names.add(r[2]);
    });
    const aggRows = Array.from(agg.values())
      .sort((a,b) => a.cat.localeCompare(b.cat,"ko") || b.posts - a.posts)
      .map(a => [a.cat, a.item, a.posts, a.names.size, a.viewSum]);
    send(res, 200, "text/html; charset=utf-8",
      renderTable("컨텐츠별 집계 보고서",
        ["category","content_item","게시물 수","참여자 수","조회수 합"],
        aggRows));
    return;
  }

  // 제출 엔드포인트 — Apps Script doPost 동등 동작
  if (req.method === "POST" && url === "/submit") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const name = (payload.name || "").toString().trim();
        const urls = Array.isArray(payload.urls) ? payload.urls : [];
        if (!name) return json(res, 200, { success: false, error: "이름이 비어 있습니다." });
        if (urls.length === 0) return json(res, 200, { success: false, error: "URL 데이터가 없습니다." });

        const submissionId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const out = [];
        urls.forEach(entry => {
          const u = (entry.url || "").toString().trim();
          const contents = Array.isArray(entry.contents) ? entry.contents : [];
          if (!u || contents.length === 0) return;
          contents.forEach(c => {
            out.push([submissionId, timestamp, name, u, c.category || "", c.item || "", 0]);
          });
        });
        if (out.length === 0) return json(res, 200, { success: false, error: "유효한 데이터가 없습니다." });

        const csv = out.map(r => r.map(csvEscape).join(",")).join("\n") + "\n";
        ensureCsv();
        fs.appendFileSync(DATA_FILE, csv, "utf8");

        console.log(`[${timestamp}] ${name} — ${out.length} 행 저장 (id=${submissionId.slice(0,8)})`);
        json(res, 200, { success: true, count: out.length, submission_id: submissionId });
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
  console.log("  ✓ 로컬 테스트 서버 실행 중");
  console.log("  ────────────────────────────────────────");
  console.log(`  입력 폼     :  http://localhost:${PORT}/`);
  console.log(`  저장 데이터  :  http://localhost:${PORT}/view`);
  console.log(`  집계 보고서  :  http://localhost:${PORT}/report`);
  console.log(`  CSV 다운로드 :  http://localhost:${PORT}/data`);
  console.log(`  저장 파일    :  ${DATA_FILE}`);
  console.log("  ────────────────────────────────────────");
  console.log("  종료: Ctrl + C");
  console.log("");
});
