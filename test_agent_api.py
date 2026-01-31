#!/usr/bin/env python3
"""
Test script for agent registration API endpoint
"""

import sys
import os
import json
import httpx
from pathlib import Path

# Add project root to path
project_root = str(Path(__file__).parent)
if project_root not in sys.path:
    sys.path.append(project_root)

# Set minimal environment variables
os.environ['DATABASE_URL'] = 'sqlite:///test_api.db'
os.environ['TELEGRAM_BOT_TOKEN'] = 'test123'
os.environ['ENCRYPTION_KEY'] = 'test123456789012345678901234567890'
os.environ['ENVIRONMENT'] = 'test'

async def test_agent_api():
    """Test the agent registration API endpoint"""
    
    print("🌐 Testing Agent Registration API")
    print("=" * 50)
    
    # Test data
    test_agent_data = {
        "name": "OpenClawAgent",
        "description": "OpenClaw integration agent for Suwappu",
        "callback_url": "https://openclaw.local/callback"
    }
    
    # Initialize the FastAPI app directly
    print("🚀 Starting FastAPI app...")
    try:
        from database.db import init_db
        from api.main import app
        
        # Initialize database
        init_db(os.environ['DATABASE_URL'])
        print("✅ Database initialized")
        
        # Import test client
        from fastapi.testclient import TestClient
        client = TestClient(app)
        
        print("✅ FastAPI app initialized")
        
    except Exception as e:
        print(f"❌ Failed to initialize FastAPI app: {e}")
        return False
    
    # Test 1: Register a new agent
    print(f"\n📝 Test 1: Register new agent")
    print(f"   Data: {test_agent_data}")
    
    try:
        response = client.post("/v1/agent/register", json=test_agent_data)
        
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 201:
            data = response.json()
            print("✅ Agent registered successfully!")
            print(f"   Agent ID: {data['agent_id']}")
            print(f"   Name: {data['name']}")
            print(f"   API Key: {data['api_key'][:20]}...")
            print(f"   Message: {data['message']}")
            
            # Store the API key for further tests
            api_key = data['api_key']
            
        else:
            print(f"❌ Registration failed")
            print(f"   Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Registration request failed: {e}")
        return False
    
    # Test 2: Test API authentication with the new key
    print(f"\n🔑 Test 2: Test API authentication with new key")
    
    try:
        # Try to access protected endpoint with new API key
        headers = {"X-Agent-API-Key": api_key}
        response = client.get("/tools", headers=headers)
        
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print("✅ Authentication successful!")
            print(f"   Available tools: {len(data.get('tools', []))}")
            
            # Show some available tools
            tools = data.get('tools', [])[:3]  # First 3 tools
            for tool in tools:
                print(f"   - {tool.get('name', 'Unknown')}: {tool.get('description', 'No description')[:50]}...")
                
        else:
            print(f"❌ Authentication failed")
            print(f"   Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Authentication test failed: {e}")
        return False
    
    # Test 3: Test with invalid API key
    print(f"\n🚫 Test 3: Test with invalid API key")
    
    try:
        headers = {"X-Agent-API-Key": "invalid_key_12345"}
        response = client.get("/tools", headers=headers)
        
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 403:
            print("✅ Correctly rejected invalid API key")
        else:
            print(f"❌ Should have rejected invalid key, got: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Invalid key test failed: {e}")
        return False
    
    # Test 4: Try to register duplicate agent
    print(f"\n🔄 Test 4: Try to register another agent")
    
    try:
        duplicate_data = {
            "name": "AnotherAgent",
            "description": "Second test agent"
        }
        
        response = client.post("/v1/agent/register", json=duplicate_data)
        
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 201:
            data = response.json()
            print("✅ Second agent registered successfully!")
            print(f"   Agent ID: {data['agent_id']}")
            print(f"   Name: {data['name']}")
            print(f"   API Key: {data['api_key'][:20]}... (different from first)")
            
        else:
            print(f"❌ Second registration failed")
            print(f"   Response: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Second registration failed: {e}")
        return False
    
    print("\n" + "=" * 50)
    print("🎉 All API tests passed! Agent registration endpoint is working correctly.")
    return True

if __name__ == "__main__":
    import asyncio
    success = asyncio.run(test_agent_api())
    sys.exit(0 if success else 1)