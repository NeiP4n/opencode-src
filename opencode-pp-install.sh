#!/bin/sh
# Installs Opencode++ for Linux and macOS:
#
#   curl -fsSL https://raw.githubusercontent.com/NeiP4n/opencode-src/lan-rooms/opencode-pp-install.sh | sh
#
# The newest release is checked out into ~/.local/share/opencode-pp and the
# `opencode` command goes to ~/.local/bin. Updates come later from the update
# prompt inside Opencode++; running this script again also updates.
set -eu

REPO="${OPENCODE_PP_REPO:-https://github.com/NeiP4n/opencode-src.git}"
DIR="${OPENCODE_PP_DIR:-$HOME/.local/share/opencode-pp}"
BIN="${OPENCODE_PP_BIN:-$HOME/.local/bin}"
BRANCH="${OPENCODE_PP_BRANCH:-lan-rooms}"

fail() {
  echo "opencode-pp: $1" >&2
  exit 1
}

command -v git >/dev/null 2>&1 || fail "git is required. Install it with your package manager, then run this again."

if ! command -v bun >/dev/null 2>&1; then
  echo "Installing Bun…"
  curl -fsSL https://bun.sh/install | bash
  PATH="$HOME/.bun/bin:$PATH"
  export PATH
fi

if [ -d "$DIR/.git" ]; then
  echo "Updating $DIR…"
  git -C "$DIR" fetch --tags --force origin
else
  echo "Downloading Opencode++ into $DIR…"
  git clone --filter=blob:none "$REPO" "$DIR"
fi

# Release tag is the normal path. Until the first release exists there is nothing to check
# out, and an installer that only knows tags leaves a newcomer with no way in at all, so the
# branch with the patches is the fallback.
TAG=$(git -C "$DIR" tag -l 'release/*' --sort=-v:refname | head -n 1)
if [ -n "$TAG" ]; then
  git -C "$DIR" checkout --quiet --detach "$TAG"
  VERSION="${TAG#release/}"
else
  echo "No release yet; installing branch $BRANCH."
  git -C "$DIR" fetch --force origin "$BRANCH"
  git -C "$DIR" checkout --quiet --detach "origin/$BRANCH"
  VERSION="$BRANCH (no release yet)"
fi

echo "Installing dependencies…"
# Only what the terminal app needs; the web and desktop apps pull far more.
(cd "$DIR" && bun install --frozen-lockfile --filter ./packages/cli)

mkdir -p "$BIN"
cat >"$BIN/opencode" <<WRAPPER
#!/bin/sh
# Opencode++ $VERSION, installed by opencode-pp-install.sh.
exec "$(command -v bun)" --config="$DIR/packages/cli/bunfig.toml" "$DIR/packages/cli/src/index.ts" "\$@"
WRAPPER
chmod +x "$BIN/opencode"

echo
echo "Opencode++ $VERSION is installed. Run: opencode"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Add $BIN to your PATH first, for example: echo 'export PATH=\"$BIN:\$PATH\"' >> ~/.profile" ;;
esac
