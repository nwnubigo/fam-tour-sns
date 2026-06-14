# ============================================================================
# 자동 배포 스크립트 — GitHub Pages 로 변경사항 1클릭 배포
#
# 사용법:
#   PowerShell 창에서:  .\deploy.ps1
#   메시지 지정:        .\deploy.ps1 "버튼 색 변경"
#   탐색기에서:         deploy.bat 더블클릭
#
# 동작:
#   1) 변경된 파일 표시
#   2) git add . → commit → push
#   3) GitHub Pages 가 약 1~2분 뒤 자동 반영
# ============================================================================

param([string]$Message = "")

Set-Location -Path $PSScriptRoot

# 변경사항 있는지 확인
$changes = git status --short
if (-not $changes) {
    Write-Host ""
    Write-Host "  변경된 파일이 없습니다." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Enter 키로 종료"
    exit 0
}

Write-Host ""
Write-Host "  변경된 파일:" -ForegroundColor Cyan
Write-Host "  --------------------------------"
$changes | ForEach-Object { Write-Host "  $_" }
Write-Host ""

# 커밋 메시지 — 인자 없으면 타임스탬프
if (-not $Message) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm"
    $Message = "Update $ts"
}
Write-Host "  커밋 메시지: $Message" -ForegroundColor Cyan
Write-Host ""

# 실행
git add . 2>&1 | Out-Host
git commit -m "$Message" 2>&1 | Out-Host
Write-Host ""
Write-Host "  GitHub 푸시 중..." -ForegroundColor Cyan
git push origin main 2>&1 | Out-Host

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "  ✓ 배포 완료!" -ForegroundColor Green
    Write-Host "  사이트: https://nwnubigo.github.io/fam-tour-sns/" -ForegroundColor Green
    Write-Host "  (GitHub Pages 빌드까지 약 1~2분 소요)" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  ✗ 푸시 실패. 위 오류 메시지를 확인하세요." -ForegroundColor Red
}
Write-Host ""
Read-Host "Enter 키로 종료"
