#!/usr/bin/env bash
set -euo pipefail

# Build a .deb package for Suwappu desktop
# Usage: ./build-deb.sh <version> <path-to-appimage>
# Example: ./build-deb.sh 0.1.0 ./Suwappu-0.1.0-x86_64.AppImage

VERSION="${1:?Usage: $0 <version> <path-to-appimage>}"
APPIMAGE="${2:?Usage: $0 <version> <path-to-appimage>}"
ARCH="amd64"
PKG_NAME="suwappu-desktop"
BUILD_DIR="$(mktemp -d)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

trap 'rm -rf "$BUILD_DIR"' EXIT

echo "Building ${PKG_NAME}_${VERSION}_${ARCH}.deb ..."

# Create directory structure
mkdir -p "${BUILD_DIR}/DEBIAN"
mkdir -p "${BUILD_DIR}/opt/suwappu"
mkdir -p "${BUILD_DIR}/usr/share/applications"
mkdir -p "${BUILD_DIR}/usr/bin"

# DEBIAN/control
cat > "${BUILD_DIR}/DEBIAN/control" <<EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Section: finance
Priority: optional
Architecture: ${ARCH}
Maintainer: Suwappu <support@suwappu.bot>
Homepage: https://suwappu.bot
Description: Cross-chain DEX trading terminal
 Suwappu is a desktop trading terminal for cross-chain
 token swaps across multiple blockchains. It supports
 swapping tokens across 7+ chains with a clean native UI.
Depends: libgtk-3-0, libnotify4, libnss3, libxss1, libxtst6, xdg-utils, libatspi2.0-0, libsecret-1-0
EOF

# DEBIAN/postinst
cat > "${BUILD_DIR}/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
chmod +x /opt/suwappu/suwappu.AppImage
update-desktop-database /usr/share/applications || true
EOF
chmod 755 "${BUILD_DIR}/DEBIAN/postinst"

# DEBIAN/postrm
cat > "${BUILD_DIR}/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "purge" ]; then
    rm -rf /opt/suwappu
fi
update-desktop-database /usr/share/applications || true
EOF
chmod 755 "${BUILD_DIR}/DEBIAN/postrm"

# Copy AppImage
cp "${APPIMAGE}" "${BUILD_DIR}/opt/suwappu/suwappu.AppImage"
chmod 755 "${BUILD_DIR}/opt/suwappu/suwappu.AppImage"

# Copy desktop entry
cp "${SCRIPT_DIR}/suwappu.desktop" "${BUILD_DIR}/usr/share/applications/suwappu.desktop"

# Create launcher symlink script
cat > "${BUILD_DIR}/usr/bin/suwappu" <<'EOF'
#!/bin/sh
exec /opt/suwappu/suwappu.AppImage "$@"
EOF
chmod 755 "${BUILD_DIR}/usr/bin/suwappu"

# Update desktop entry Exec/Icon to match deb paths
sed -i 's|Exec=/opt/suwappu/suwappu|Exec=/usr/bin/suwappu|' \
    "${BUILD_DIR}/usr/share/applications/suwappu.desktop"

# Build the .deb
dpkg-deb --build --root-owner-group "${BUILD_DIR}" "${PKG_NAME}_${VERSION}_${ARCH}.deb"

echo "Created ${PKG_NAME}_${VERSION}_${ARCH}.deb"
