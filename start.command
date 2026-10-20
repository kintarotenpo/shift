#!/bin/bash
# SHIFT BOARD をこのMacで動作確認するための起動スクリプト
# Finder でダブルクリックすると、ローカルサーバーを起動してブラウザで開きます。

cd "$(dirname "$0")" || exit 1
PORT=8000

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 が見つからないため、index.html を直接開きます。"
  open index.html
  exit 0
fi

if lsof -i :$PORT >/dev/null 2>&1; then
  echo "ポート $PORT は既に使用中です。すでに起動している場合はブラウザで http://localhost:$PORT を開いてください。"
  open "http://localhost:$PORT/"
  exit 0
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)

echo "========================================"
echo " SHIFT BOARD を起動しました"
echo ""
echo " このMacで確認:      http://localhost:$PORT"
if [ -n "$IP" ]; then
echo " 同じWi-Fiのスマホで: http://$IP:$PORT"
fi
echo ""
echo " 終了するには、このウィンドウで Ctrl+C を押すか"
echo " ウィンドウを閉じてください。"
echo "========================================"

(sleep 1; open "http://localhost:$PORT/") &
python3 -m http.server $PORT
