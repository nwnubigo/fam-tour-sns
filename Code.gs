/**
 * 농촌관광 팸투어 SNS 홍보글 수집 - Google Apps Script 백엔드 (v2)
 *
 *   action: "submit"  → 신규 등록
 *   action: "lookup"  → 이름+비밀번호로 본인 데이터 조회
 *   action: "update"  → 이름+비밀번호 일치 시 기존 행 삭제 후 새 데이터 추가
 *
 * [DB 스키마]
 *   submission_id | timestamp | name | sns_url | category | content_item | view_count | password
 *   (한 행 = 1개 게시물 × 1개 노출컨텐츠)
 *
 * [재배포] 코드 수정 후 반드시 [배포 > 배포 관리 > 편집(✏️) > 새 버전 > 배포] 필요.
 */

const SHEET_NAME = "Submissions";
const HEADERS = [
  "submission_id",
  "timestamp",
  "name",
  "sns_url",
  "category",
  "content_item",
  "view_count",
  "password"
];
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action || "submit";
    if (action === "submit") return handleSubmit(payload);
    if (action === "lookup") return handleLookup(payload);
    if (action === "update") return handleUpdate(payload);
    return jsonResponse({ success: false, error: "알 수 없는 요청: " + action });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet() {
  return jsonResponse({ success: true, message: "농촌관광 SNS 수집 API v2 동작 중" });
}

/* ---------- 액션 핸들러 ---------- */

function handleSubmit(payload) {
  const name = (payload.name || "").toString().trim();
  const password = (payload.password || "").toString();
  const urls = Array.isArray(payload.urls) ? payload.urls : [];

  if (!name) return jsonResponse({ success: false, error: "이름이 비어 있습니다." });
  if (!password) return jsonResponse({ success: false, error: "비밀번호가 비어 있습니다." });
  if (urls.length === 0) return jsonResponse({ success: false, error: "URL 데이터가 없습니다." });

  const sheet = getOrCreateSheet();
  const submissionId = Utilities.getUuid();
  const timestamp = new Date();

  const rows = buildRows(submissionId, timestamp, name, urls, password);
  if (rows.length === 0) return jsonResponse({ success: false, error: "유효한 데이터가 없습니다." });

  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
  return jsonResponse({ success: true, count: rows.length, submission_id: submissionId });
}

function handleLookup(payload) {
  const name = (payload.name || "").toString().trim();
  const password = (payload.password || "").toString();
  if (!name || !password) return jsonResponse({ success: false, error: "이름과 비밀번호를 입력하세요." });

  const sheet = getOrCreateSheet();
  const last = sheet.getLastRow();
  if (last < 2) return jsonResponse({ success: false, error: "등록된 데이터가 없습니다." });

  const data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const matched = data.filter(r => r[2] === name && String(r[7]) === password);
  if (matched.length === 0) {
    return jsonResponse({ success: false, error: "이름 또는 비밀번호가 일치하지 않습니다." });
  }

  // sns_url 기준으로 묶어서 카드 형태로 반환
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
  return jsonResponse({ success: true, urls: Array.from(byUrl.values()) });
}

function handleUpdate(payload) {
  const name = (payload.name || "").toString().trim();
  const password = (payload.password || "").toString();
  const urls = Array.isArray(payload.urls) ? payload.urls : [];

  if (!name || !password) return jsonResponse({ success: false, error: "이름과 비밀번호를 입력하세요." });

  const sheet = getOrCreateSheet();
  const last = sheet.getLastRow();
  if (last < 2) return jsonResponse({ success: false, error: "삭제할 데이터가 없습니다." });

  const data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  // 일치하는 행 인덱스 (시트의 1-indexed 행 번호) 수집
  const rowsToDelete = [];
  data.forEach((r, i) => {
    if (r[2] === name && String(r[7]) === password) rowsToDelete.push(i + 2);
  });

  if (rowsToDelete.length === 0) {
    return jsonResponse({ success: false, error: "이름 또는 비밀번호가 일치하지 않습니다." });
  }

  // 아래에서 위로 삭제 → 인덱스 보존
  rowsToDelete.sort((a, b) => b - a).forEach(idx => sheet.deleteRow(idx));

  // 새 데이터 append
  let inserted = 0;
  let submissionId = null;
  if (urls.length > 0) {
    submissionId = Utilities.getUuid();
    const newRows = buildRows(submissionId, new Date(), name, urls, password);
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, HEADERS.length).setValues(newRows);
      inserted = newRows.length;
    }
  }

  return jsonResponse({
    success: true,
    deleted: rowsToDelete.length,
    inserted: inserted,
    submission_id: submissionId
  });
}

/* ---------- 유틸 ---------- */

function buildRows(submissionId, timestamp, name, urls, password) {
  const rows = [];
  urls.forEach(entry => {
    const url = (entry.url || "").toString().trim();
    const contents = Array.isArray(entry.contents) ? entry.contents : [];
    if (!url || contents.length === 0) return;
    contents.forEach(c => {
      rows.push([
        submissionId,
        timestamp,
        name,
        url,
        c.category || "",
        c.item || "",
        Number(c.view_count) || 0,
        password
      ]);
    });
  });
  return rows;
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    formatHeader(sheet);
    enforcePasswordTextFormat(sheet);
    return sheet;
  }
  // 기존 시트 — password 컬럼 없으면 추가 (마이그레이션)
  const lastCol = sheet.getLastColumn();
  const existing = sheet.getRange(1, 1, 1, Math.max(lastCol, HEADERS.length)).getValues()[0];
  if (existing[7] !== "password") {
    sheet.getRange(1, 8).setValue("password");
    formatHeader(sheet);
  }
  enforcePasswordTextFormat(sheet);
  return sheet;
}

function formatHeader(sheet) {
  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#2d7a3e")
    .setFontColor("#ffffff");
  sheet.setFrozenRows(1);
  const widths = [240, 160, 100, 280, 130, 160, 90, 200];
  widths.forEach((w, i) => sheet.setColumnWidth(i + 1, w));
}

/**
 * H열(password) 을 평문 텍스트로 강제 — Sheets 의 자동 변환을 막음
 *   - "0123" → 앞 0 유지
 *   - "=ABC" → 수식으로 해석되지 않고 리터럴로 저장
 *   - "1-2-3" → 날짜로 변환되지 않음
 *   - 큰 숫자 → 지수 표기 안 됨
 */
function enforcePasswordTextFormat(sheet) {
  sheet.getRange("H:H").setNumberFormat("@");
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- 보고서용 유틸 ---------- */

function reportByContent() {
  const sheet = getOrCreateSheet();
  const last = sheet.getLastRow();
  if (last < 2) { Logger.log("데이터 없음"); return; }
  const data = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const agg = {};
  data.forEach(r => {
    const item = r[5];
    if (!item) return;
    if (!agg[item]) agg[item] = { category: r[4], posts: 0, viewSum: 0, participants: new Set() };
    agg[item].posts += 1;
    agg[item].viewSum += Number(r[6]) || 0;
    agg[item].participants.add(r[2]);
  });
  Object.keys(agg).forEach(k => {
    const r = agg[k];
    Logger.log(`[${r.category}] ${k} — 게시물 ${r.posts}건 / 참여자 ${r.participants.size}명 / 조회수합 ${r.viewSum}`);
  });
}
