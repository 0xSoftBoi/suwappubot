#!/bin/bash

# Suwappu iOS App - Test Runner Script
# This script helps you run tests for the iOS app

set -e

echo "🧪 Suwappu iOS App - Test Runner 🧪"
echo "===================================="
echo ""

# Check if Xcode is installed
if ! command -v xcodebuild &> /dev/null; then
    echo "⚠️  xcodebuild not found"
    echo ""
    echo "To run tests, you need:"
    echo "1. Full Xcode installed (not just Command Line Tools)"
    echo "2. Open the project in Xcode"
    echo "3. Press ⌘U to run tests"
    echo ""
    echo "Opening Xcode project..."
    cd "$(dirname "$0")"
    open SuwappuApp.xcodeproj
    exit 0
fi

# Check if we're in the right directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_FILE="$SCRIPT_DIR/SuwappuApp.xcodeproj"

if [ ! -d "$PROJECT_FILE" ]; then
    echo "❌ Xcode project not found: $PROJECT_FILE"
    exit 1
fi

echo "✅ Found project: $PROJECT_FILE"
echo ""

# List available simulators
echo "📱 Available simulators:"
xcrun simctl list devices available | grep "iPhone" | head -n 5 | sed 's/^/   /'
echo ""

# Get first available iPhone simulator
SIMULATOR=$(xcrun simctl list devices available | grep "iPhone" | head -n 1 | sed 's/.*(\(.*\))/\1/' | tr -d ' ')

if [ -z "$SIMULATOR" ]; then
    echo "⚠️  No iPhone simulator found"
    echo "Please create a simulator in Xcode first"
    echo ""
    echo "Opening Xcode..."
    open "$PROJECT_FILE"
    exit 0
fi

echo "🎯 Using simulator: $SIMULATOR"
echo ""

# Check if test targets exist
echo "🔍 Checking test targets..."
SCHEMES=$(xcodebuild -list -project "$PROJECT_FILE" 2>/dev/null | grep -A 10 "Schemes:" | tail -n +2 | sed 's/^[[:space:]]*//' | grep -v "^$" | head -n 1)

if [ -z "$SCHEMES" ]; then
    echo "⚠️  No schemes found"
    echo ""
    echo "Please:"
    echo "1. Open the project in Xcode"
    echo "2. Add test files to the test target"
    echo "3. Create a test scheme"
    echo ""
    echo "Opening Xcode..."
    open "$PROJECT_FILE"
    exit 0
fi

echo "✅ Found scheme: $SCHEMES"
echo ""

# Ask user what they want to do
echo "What would you like to do?"
echo "1) Run all tests"
echo "2) Run unit tests only"
echo "3) Run UI tests only"
echo "4) Open Xcode to run tests manually"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
    1)
        echo ""
        echo "🚀 Running all tests..."
        xcodebuild test \
            -project "$PROJECT_FILE" \
            -scheme "$SCHEMES" \
            -destination "platform=iOS Simulator,id=$SIMULATOR" \
            | xcpretty
        ;;
    2)
        echo ""
        echo "🚀 Running unit tests..."
        xcodebuild test \
            -project "$PROJECT_FILE" \
            -scheme "$SCHEMES" \
            -destination "platform=iOS Simulator,id=$SIMULATOR" \
            -only-testing:SuwappuAppTests \
            | xcpretty
        ;;
    3)
        echo ""
        echo "🚀 Running UI tests..."
        xcodebuild test \
            -project "$PROJECT_FILE" \
            -scheme "$SCHEMES" \
            -destination "platform=iOS Simulator,id=$SIMULATOR" \
            -only-testing:SuwappuAppUITests \
            | xcpretty
        ;;
    4)
        echo ""
        echo "Opening Xcode..."
        open "$PROJECT_FILE"
        echo ""
        echo "In Xcode:"
        echo "1. Press ⌘U to run all tests"
        echo "2. Or click the test diamond icons next to each test"
        ;;
    *)
        echo "Invalid choice. Opening Xcode..."
        open "$PROJECT_FILE"
        ;;
esac

echo ""
echo "✅ Done!"


