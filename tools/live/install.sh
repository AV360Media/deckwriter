#!/bin/bash
# Sets up DeckWriter Live on this Mac as a background service: no Terminal window, starts when you log in,
# restarts itself if it stops, and fetches the latest relay from GitHub each time it starts.
#   install:    curl -fsSL https://raw.githubusercontent.com/bryanchorton/deckwriter/main/tools/live/install.sh | bash
#   uninstall:  curl -fsSL https://raw.githubusercontent.com/bryanchorton/deckwriter/main/tools/live/install.sh | bash -s -- --uninstall
set -euo pipefail

LABEL="com.deckwriter.relay"
DIR="$HOME/Library/Application Support/DeckWriter"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/DeckWriter-relay.log"
URL="https://raw.githubusercontent.com/bryanchorton/deckwriter/main/tools/live/relay.mjs"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "--uninstall" ]; then
	launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
	rm -f "$PLIST"
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

mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
curl -fsSL "$URL" -o "$DIR/relay.mjs"

# Each start: try to update the relay (keep the old copy if offline), then run it.
cat >"$DIR/start.sh" <<EOF
#!/bin/bash
curl -fsSL --max-time 10 "$URL" -o "$DIR/relay.new" && mv "$DIR/relay.new" "$DIR/relay.mjs"
NODE="$NODE"
[ -x "\$NODE" ] || for n in /Applications/Companion.app/Contents/Resources/node-runtimes/node*/bin/node; do [ -x "\$n" ] && NODE="\$n"; done
exec "\$NODE" "$DIR/relay.mjs"
EOF
chmod +x "$DIR/start.sh"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>$LABEL</string>
	<key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/start.sh</string></array>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>ThrottleInterval</key><integer>5</integer>
	<key>StandardOutPath</key><string>$LOG</string>
	<key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "DeckWriter Live is running in the background and will start whenever you log in."
echo "Log: $LOG"
