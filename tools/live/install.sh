#!/bin/bash
# Sets up DeckWriter Live on this Mac. Nothing runs until you click Live in DeckWriter: that opens a
# deckwriter-live:// link, a tiny helper app ("DeckWriter Live" in ~/Applications) starts the relay as a background
# service (no Terminal window), and the relay stops itself 10 minutes after DeckWriter stops checking in.
# Each start fetches the latest relay from GitHub.
#   install:    curl -fsSL https://raw.githubusercontent.com/AV360Media/deckwriter/main/tools/live/install.sh | bash
#   uninstall:  curl -fsSL https://raw.githubusercontent.com/AV360Media/deckwriter/main/tools/live/install.sh | bash -s -- --uninstall
set -euo pipefail

LABEL="com.deckwriter.relay"
DIR="$HOME/Library/Application Support/DeckWriter"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/Applications/DeckWriter Live.app"
LOG="$HOME/Library/Logs/DeckWriter-relay.log"
URL="https://raw.githubusercontent.com/AV360Media/deckwriter/main/tools/live/relay.mjs"
DOMAIN="gui/$(id -u)"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

if [ "${1:-}" = "--uninstall" ]; then
	launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
	rm -f "$PLIST"
	[ -d "$APP" ] && { "$LSREGISTER" -u "$APP" 2>/dev/null || true; rm -rf "$APP"; }
	echo "DeckWriter Live is uninstalled. (Its files in $DIR were left in place.)"
	exit 0
fi

# Companion ships its own Node: the relay is tested on node22, otherwise use the newest one it has
pick_node() {
	local rt=/Applications/Companion.app/Contents/Resources/node-runtimes n found=""
	[ -x "$rt/node22/bin/node" ] && { echo "$rt/node22/bin/node"; return; }
	for n in "$rt"/node*/bin/node; do [ -x "$n" ] && found="$n"; done
	echo "$found"
}
NODE="$(pick_node)"
if [ -z "$NODE" ]; then
	echo "Couldn't find Companion in /Applications. Install Companion first, then run this again." >&2
	exit 1
fi

mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$HOME/Applications"
curl -fsSL "$URL" -o "$DIR/relay.mjs"

# Each start: try to update the relay (keep the old copy if offline), then run it until DeckWriter goes quiet.
cat >"$DIR/start.sh" <<EOF
#!/bin/bash
curl -fsSL --max-time 10 "$URL" -o "$DIR/relay.new" && mv "$DIR/relay.new" "$DIR/relay.mjs"
NODE="$NODE"
[ -x "\$NODE" ] || for n in /Applications/Companion.app/Contents/Resources/node-runtimes/node*/bin/node; do [ -x "\$n" ] && NODE="\$n"; done
exec "\$NODE" "$DIR/relay.mjs" --idle-exit 600
EOF
chmod +x "$DIR/start.sh"

# On demand only: no RunAtLoad, no KeepAlive. The helper app below starts it.
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/start.sh</string></array>
	<key>StandardOutPath</key><string>$LOG</string>
	<key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
# a service that was just unloaded can take a moment to go away; until then launchd refuses the new one
ok=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
	if launchctl bootstrap "$DOMAIN" "$PLIST" 2>/dev/null; then ok=1; break; fi
	sleep 1
done
[ -n "$ok" ] || { echo "Couldn't register the DeckWriter Live service with launchd. Log out and back in, then run this again." >&2; exit 1; }

# The helper app: opens for deckwriter-live:// links, starts the service, quits. No Dock icon.
rm -rf "$APP"
osacompile -o "$APP" \
	-e 'on open location u' -e 'startLive()' -e 'end open location' \
	-e 'on run' -e 'startLive()' -e 'end run' \
	-e 'on startLive()' -e "do shell script \"launchctl kickstart gui/$(id -u)/$LABEL\"" -e 'end startLive'
INFO="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.deckwriter.live" "$INFO" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.deckwriter.live" "$INFO"
/usr/libexec/PlistBuddy -c "Delete :CFBundleURLTypes" "$INFO" 2>/dev/null || true
/usr/libexec/PlistBuddy \
	-c "Add :CFBundleURLTypes array" \
	-c "Add :CFBundleURLTypes:0 dict" \
	-c "Add :CFBundleURLTypes:0:CFBundleURLName string com.deckwriter.live" \
	-c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" \
	-c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string deckwriter-live" \
	"$INFO"
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$INFO" 2>/dev/null || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$INFO"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
"$LSREGISTER" -f "$APP"

echo "DeckWriter Live is set up. Nothing runs at login: clicking Live in DeckWriter starts it,"
echo "and it stops by itself 10 minutes after DeckWriter is closed or Live is switched off."
echo "Log: $LOG"
