#!/bin/zsh
# Install / remove a LaunchAgent that starts mac-vibe-coder at login and keeps it alive.
#   scripts/launchd.sh install
#   scripts/launchd.sh uninstall
#   scripts/launchd.sh status
set -e
LABEL="com.hdomi.mac-vibe-coder"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/mac-vibe-coder.log"

case "${1:-status}" in
  install)
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>$ROOT/bin/start.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "installed: $PLIST"
    echo "log: $LOG"
    echo "macOS 가 Desktop/Documents 접근 권한을 물으면 허용해. 안 뜨면 시스템 설정 > 개인정보 보호 > 전체 디스크 접근 권한에 Mac Vibe Coder 추가."
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | head -20 || echo "not installed"
    ;;
  *)
    echo "usage: $0 install|uninstall|status"; exit 1;;
esac
