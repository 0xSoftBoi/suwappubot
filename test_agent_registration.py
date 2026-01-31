#!/usr/bin/env python3
"""
Test script for agent registration system
"""

import sys
import os
import secrets
from pathlib import Path
from datetime import datetime

# Add project root to path
project_root = str(Path(__file__).parent)
if project_root not in sys.path:
    sys.path.append(project_root)

# Set minimal environment variables
os.environ['DATABASE_URL'] = 'sqlite:///test_registration.db'
os.environ['TELEGRAM_BOT_TOKEN'] = 'test123'
os.environ['ENCRYPTION_KEY'] = 'test123456789012345678901234567890'
os.environ['ENVIRONMENT'] = 'test'

# Import after setting environment
from database.db import init_db, get_session
from bot.models.agent import RegisteredAgent

def test_agent_registration():
    """Test the agent registration functionality"""
    
    print("🧪 Testing Agent Registration System")
    print("=" * 50)
    
    # Initialize database
    print("📅 Initializing database...")
    try:
        init_db(os.environ['DATABASE_URL'])
        print("✅ Database initialized successfully")
    except Exception as e:
        print(f"❌ Database initialization failed: {e}")
        return False
    
    # Test 1: Create a new registered agent
    print("\n🔧 Test 1: Create new registered agent")
    try:
        api_key = f"suw_ag_{secrets.token_urlsafe(32)}"
        
        with get_session() as session:
            agent = RegisteredAgent(
                name="TestAgent",
                description="Test agent for registration system",
                callback_url="https://example.com/callback",
                api_key=api_key,
                is_active=True,
                created_at=datetime.utcnow(),
            )
            session.add(agent)
            session.commit()
            session.refresh(agent)
            
            print(f"✅ Created agent with ID: {agent.id}")
            print(f"   Name: {agent.name}")
            print(f"   API Key: {api_key[:20]}...")
            print(f"   Created: {agent.created_at}")
        
    except Exception as e:
        print(f"❌ Failed to create agent: {e}")
        return False
    
    # Test 2: Query the registered agent
    print("\n🔍 Test 2: Query registered agent by API key")
    try:
        with get_session() as session:
            found_agent = session.query(RegisteredAgent).filter(
                RegisteredAgent.api_key == api_key,
                RegisteredAgent.is_active == True,
            ).first()
            
            if found_agent:
                print("✅ Found agent successfully")
                print(f"   ID: {found_agent.id}")
                print(f"   Name: {found_agent.name}")
                print(f"   Active: {found_agent.is_active}")
            else:
                print("❌ Agent not found")
                return False
    except Exception as e:
        print(f"❌ Failed to query agent: {e}")
        return False
    
    # Test 3: Update last_seen_at (simulates authentication)
    print("\n⏰ Test 3: Update last_seen_at timestamp")
    try:
        with get_session() as session:
            agent = session.query(RegisteredAgent).filter(
                RegisteredAgent.api_key == api_key,
                RegisteredAgent.is_active == True,
            ).first()
            
            if agent:
                old_time = agent.last_seen_at
                agent.last_seen_at = datetime.utcnow()
                session.commit()
                
                print("✅ Updated last_seen_at timestamp")
                print(f"   Old: {old_time}")
                print(f"   New: {agent.last_seen_at}")
            else:
                print("❌ Agent not found for update")
                return False
    except Exception as e:
        print(f"❌ Failed to update timestamp: {e}")
        return False
    
    # Test 4: Test API key uniqueness
    print("\n🔒 Test 4: Test API key uniqueness constraint")
    try:
        with get_session() as session:
            # Try to create another agent with same API key
            duplicate_agent = RegisteredAgent(
                name="DuplicateAgent",
                description="Should fail due to duplicate API key",
                api_key=api_key,  # Same key as before
                is_active=True,
                created_at=datetime.utcnow(),
            )
            session.add(duplicate_agent)
            session.commit()
            
            print("❌ Duplicate API key was allowed (this should not happen)")
            return False
            
    except Exception as e:
        print(f"✅ Correctly rejected duplicate API key: {type(e).__name__}")
    
    # Test 5: List all registered agents
    print("\n📋 Test 5: List all registered agents")
    try:
        with get_session() as session:
            agents = session.query(RegisteredAgent).all()
            print(f"✅ Found {len(agents)} registered agent(s)")
            
            for agent in agents:
                status = "🟢 Active" if agent.is_active else "🔴 Inactive"
                print(f"   - {agent.name} (ID: {agent.id}) {status}")
                
    except Exception as e:
        print(f"❌ Failed to list agents: {e}")
        return False
    
    print("\n" + "=" * 50)
    print("🎉 All tests passed! Agent registration system is working correctly.")
    return True

if __name__ == "__main__":
    success = test_agent_registration()
    sys.exit(0 if success else 1)