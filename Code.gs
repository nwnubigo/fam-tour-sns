/**
 * 농촌관광 팸투어 SNS 홍보글 수집 - Google Apps Script 백엔드
 *
 * [배포 방법]
 * 1) 새 Google Sheets 생성 (예: "팸투어_SNS홍보글")
 * 2) 시트 메뉴 > 확장 프로그램 > Apps Script 클릭
 * 3) 이 파일 전체 내용을 붙여넣고 저장
 * 4) 우상단 [배포] > [새 배포] > 유형: 웹 앱
 *    - 다음 사용자 인증으로 실행: 나
 *    - 액세스 권한이 있는 사용자: 모든 사용자
 * 5) 발급된 웹 앱 URL (.../exec) 을 index.html 의 APPS_SCRIPT_URL 에 붙여넣기
 *
 * [DB 구조 — 컨텐츠별 보고서 작성 최적화]
 *  시트 "Submissions": 각 행 = (게시물 1개 × 노출컨텐츠 1개)
 *    submission_id | timestamp | name | sns_url | category | content_item | view_count
 *  → 컨텐츠 항목별 필터/피벗 으로 보고서 작성 용이
 *  → view_count 는 0 으로 저장 후, 추후 수동/스크립트로 업데이트
 */

const SHEET_NAME = "Submissions";
const HEADERS = [
  "submission_id",
  "timestamp",
  "name",
  "sns_url",
  "category",
  "content_item",
  "view_count"
];

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const name = (payload.name || "").toString().trim();
    const urls = Array.isArray(payload.urls) ? payload.urls : [];

    if (!name) return jsonResponse({ success: false, error: "이름이 비어 있습니다." });
    if (urls.length === 0) return jsonResponse({ success: false, error: "URL 데이터가 없습니다." });

    const sheet = getOrCreateSheet();
    const submissionId = Utilities.getUuid();
    const timestamp = new Date();

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
          0  // view_count - 추후 입력
        ]);
      });
    });

    if (rows.length === 0) {
      return jsonResponse({ success: false, error: "유효한 데이터가 없습니다." });
    }

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);

    return jsonResponse({ success: true, count: rows.length, submission_id: submissionId });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

function doGet() {
  return jsonResponse({ success: true, message: "농촌관광 팸투어 SNS 수집 API 동작 중" });
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#2d7a3e")
      .setFontColor("#ffffff");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 240); // submission_id
    sheet.setColumnWidth(2, 160); // timestamp
    sheet.setColumnWidth(3, 100); // name
    sheet.setColumnWidth(4, 280); // sns_url
    sheet.setColumnWidth(5, 130); // category
    sheet.setColumnWidth(6, 160); // content_item
    sheet.setColumnWidth(7, 90);  // view_count
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 보고서용 유틸 — Apps Script 에디터에서 실행하면 컨텐츠별 집계를 콘솔에 출력
 * (시트에서는 피벗 테이블 또는 =QUERY() 로도 쉽게 가능)
 */
function reportByContent() {
  const sheet = getOrCreateSheet();
  const data = sheet.getRange(2, 1, Math.max(0, sheet.getLastRow() - 1), HEADERS.length).getValues();
  const agg = {};
  data.forEach(row => {
    const item = row[5];
    if (!item) return;
    if (!agg[item]) agg[item] = { category: row[4], posts: 0, viewSum: 0, participants: new Set() };
    agg[item].posts += 1;
    agg[item].viewSum += Number(row[6]) || 0;
    agg[item].participants.add(row[2]);
  });
  Object.keys(agg).forEach(k => {
    const r = agg[k];
    Logger.log(`[${r.category}] ${k} — 게시물 ${r.posts}건 / 참여자 ${r.participants.size}명 / 조회수합 ${r.viewSum}`);
  });
}
