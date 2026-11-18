#!/bin/sh
# ideabox 辦公室：把這台電腦上 Claude Code 的狀態（開工、交代了什麼、還在用工具、等你回覆、等你同意、結束）回報給 ideabox。
# 由 ~/.claude/settings.json 的 hooks 呼叫（設成 "async": true，在背景跑、不拖慢 Claude）；Claude Code 從標準輸入傳一段 JSON 進來。
# - 最多等 5 秒，失敗也不影響 Claude Code；不輸出任何東西
# - PostToolUse（每用完一個工具）當作心跳，同一個對話最多每 60 秒送一次；開新工作階段（交接）例外，一定送
# - 桌面 App 的工作階段編號（CLAUDE_CODE_HOST_SESSION_ID）放在 x-ideabox-host，辦公室用來對「誰把工作交給誰」
# - 密鑰：環境變數 IDEABOX_HOOK_SECRET（雲端的 Claude Code 用），或 ~/.claude/ideabox-hook.secret（這台電腦用）；
#   兩個都沒有就什麼都不做（例如別人 clone 了這個 repo）
# - 網址：環境變數 IDEABOX_URL，或 ~/.claude/ideabox-hook.url（例如 https://my-ideabox.vercel.app，結尾不要斜線）

SECRET="${IDEABOX_HOOK_SECRET:-}"
SECRET_FILE="$HOME/.claude/ideabox-hook.secret"
[ -z "$SECRET" ] && [ -r "$SECRET_FILE" ] && SECRET=$(cat "$SECRET_FILE")
[ -n "$SECRET" ] || exit 0
URL_DEFAULT=""
URL="${IDEABOX_URL:-}"
[ -z "$URL" ] && [ -r "$HOME/.claude/ideabox-hook.url" ] && URL=$(cat "$HOME/.claude/ideabox-hook.url")
[ -z "$URL" ] && URL="$URL_DEFAULT"
[ -n "$URL" ] || exit 0
BODY=$(cat)

case "$BODY" in
  # 開新工作階段（交接）一定要送，不受每分鐘一次的限制
  *ccd_session__start_session* | *ccd_session__hand_off_to_session*) ;;
  *'"hook_event_name":"PostToolUse"'* | *'"hook_event_name": "PostToolUse"'*)
    SID=$(printf '%s' "$BODY" | sed -n 's/.*"session_id" *: *"\([A-Za-z0-9_-]*\)".*/\1/p' | head -n 1)
    STAMP="${TMPDIR:-/tmp}/ideabox-office-${SID:-unknown}"
    NOW=$(date +%s)
    LAST=$(cat "$STAMP" 2>/dev/null || echo 0)
    [ $((NOW - LAST)) -lt 60 ] && exit 0
    echo "$NOW" > "$STAMP" 2>/dev/null
    ;;
esac

printf '%s' "$BODY" | curl -s -m 5 -X POST "${URL%/}/api/claude/hook" \
  -H "content-type: application/json" \
  -H "x-ideabox-hook: $SECRET" \
  -H "x-ideabox-host: ${CLAUDE_CODE_HOST_SESSION_ID:-}" \
  --data-binary @- >/dev/null 2>&1
exit 0
