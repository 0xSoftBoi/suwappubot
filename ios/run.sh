#!/bin/bash

# Suwappu iOS App - Quick Run Script
# This script helps you open and run the iOS app locally

set -e

echo "🌸 Suwappu iOS App - Local Runner 🌸"
echo "======================================"
echo ""

# Check if Xcode is installed
if ! command -v xcodebuild &> /dev/null; then
    echo "❌ Xcode is not installed or not in PATH"
    echo "Please install Xcode from the App Store"
    exit 1
fi

echo "✅ Xcode found: $(xcodebuild -version | head -n 1)"
echo ""

# Navigate to project directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$SCRIPT_DIR/SuwappuApp"
PROJECT_FILE="$PROJECT_DIR/SuwappuApp.xcodeproj"

if [ ! -d "$PROJECT_DIR" ]; then
    echo "❌ Project directory not found: $PROJECT_DIR"
    exit 1
fi

if [ ! -d "$PROJECT_FILE" ]; then
    echo "❌ Xcode project not found: $PROJECT_FILE"
    echo "Creating new Xcode project..."
    echo ""
    echo "Please create a new Xcode project manually:"
    echo "1. Open Xcode"
    echo "2. File → New → Project"
    echo "3. Choose iOS → App"
    echo "4. Product Name: SuwappuApp"
    echo "5. Interface: SwiftUI"
    echo "6. Language: Swift"
    echo ""
    echo "Then copy files from: $PROJECT_DIR/SuwappuApp/"
    exit 1
fi

echo "📁 Project found: $PROJECT_FILE"
echo ""

# Check for available simulators
echo "📱 Checking available simulators..."
SIMULATORS=$(xcrun simctl list devices available | grep "iPhone" | head -n 5)
if [ -z "$SIMULATORS" ]; then
    echo "⚠️  No iPhone simulators found"
    echo "Opening Xcode - please create a simulator first"
else
    echo "Available simulators:"
    echo "$SIMULATORS" | sed 's/^/   /'
    echo ""
fi

# Open project in Xcode
echo "🚀 Opening project in Xcode..."
open "$PROJECT_FILE"

echo ""
echo "✅ Project opened in Xcode!"
echo ""
echo "Next steps:"
echo "1. Select a simulator (top toolbar)"
echo "2. Press ⌘R to build and run"
echo "3. Or click the Play button ▶️"
echo ""
echo "🌸 Happy coding! 🌸"


