#!/usr/bin/env python3
"""
Debug helper script for Suwappu Bot.
Enables remote debugging with debugpy.

Usage:
    python scripts/debug.py bot      # Debug bot/main.py
    python scripts/debug.py api      # Debug API server
    python scripts/debug.py --port 5679  # Use custom port
"""

import sys
import os
import argparse
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def setup_debugpy(port=5678, wait_for_client=False):
    """Setup debugpy for remote debugging."""
    try:
        import debugpy
        debugpy.listen(("0.0.0.0", port))
        print(f"🐛 Debugpy listening on port {port}")
        if wait_for_client:
            print("⏳ Waiting for debugger to attach...")
            debugpy.wait_for_client()
            print("✅ Debugger attached!")
        return True
    except ImportError:
        print("❌ debugpy not installed. Install with: pip install debugpy")
        return False
    except Exception as e:
        print(f"❌ Failed to setup debugpy: {e}")
        return False

def run_bot():
    """Run bot with debugging enabled."""
    if not setup_debugpy(wait_for_client=False):
        return
    
    print("🚀 Starting bot with debugging enabled...")
    from bot.main import main
    main()

def run_api():
    """Run API server with debugging enabled."""
    if not setup_debugpy(wait_for_client=False):
        return
    
    print("🚀 Starting API server with debugging enabled...")
    import uvicorn
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )

def main():
    parser = argparse.ArgumentParser(description="Debug helper for Suwappu Bot")
    parser.add_argument(
        "target",
        choices=["bot", "api"],
        help="Target to debug: 'bot' or 'api'"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5678,
        help="Debugpy port (default: 5678)"
    )
    parser.add_argument(
        "--wait",
        action="store_true",
        help="Wait for debugger to attach before starting"
    )
    
    args = parser.parse_args()
    
    # Override port if specified
    if args.port != 5678:
        os.environ["DEBUGPY_PORT"] = str(args.port)
    
    if args.target == "bot":
        run_bot()
    elif args.target == "api":
        run_api()

if __name__ == "__main__":
    main()
