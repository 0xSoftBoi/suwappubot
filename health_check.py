#!/usr/bin/env python3
"""
Health check script for Suwappu Bot.

This script checks the health of various components:
- Database connectivity
- RPC endpoints
- External APIs
- Cache systems
- Configuration
"""

import sys
import os
import asyncio
import aiohttp
from datetime import datetime

# Add the bot directory to the path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bot.config.settings import settings
from bot.config.chains import CHAINS, ChainType
from bot.utils.cache import price_cache, quote_cache, balance_cache, gas_cache
from database.db import get_session, init_db
from bot.models.user import User, Wallet
from bot.models.swap import SwapTransaction, SwapStatus

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

class HealthCheck:
    def __init__(self):
        self.results = {
            'database': {'status': None, 'message': ''},
            'rpc_endpoints': {},
            'external_apis': {},
            'caches': {},
            'configuration': {},
            'overall': 'unknown'
        }
        self.start_time = datetime.utcnow()
        
    def print_header(self, text):
        print(f"\n{BLUE}========================================{RESET}")
        print(f"{BLUE}{text}{RESET}")
        print(f"{BLUE}========================================{RESET}")
        
    def print_result(self, component, status, message):
        icon = '✅' if status else '❌'
        color = GREEN if status else RED
        print(f"{color}{icon} {component}: {message}{RESET}")
        
    def check_database(self):
        """Check database connectivity and basic operations."""
        self.print_header("Database Health Check")
        
        try:
            # Initialize database if needed
            init_db(settings.database_url)
            
            with get_session() as session:
                # Test basic query
                user_count = session.query(User).count()
                wallet_count = session.query(Wallet).count()
                swap_count = session.query(SwapTransaction).count()
                
                self.print_result(
                    "Database Connection",
                    True,
                    f"Connected (Users: {user_count}, Wallets: {wallet_count}, Swaps: {swap_count})"
                )
                
                self.results['database'] = {
                    'status': True,
                    'message': f"Connected with {user_count} users, {wallet_count} wallets, {swap_count} swaps",
                    'users': user_count,
                    'wallets': wallet_count,
                    'swaps': swap_count
                }
                
        except Exception as e:
            self.print_result("Database Connection", False, f"Error: {str(e)}")
            self.results['database'] = {
                'status': False,
                'message': f"Connection failed: {str(e)}"
            }
            return False
        
        return True

    async def check_rpc_endpoints(self):
        """Check RPC endpoint connectivity."""
        self.print_header("RPC Endpoints Health Check")
        
        results = {}
        for chain_name, chain in CHAINS.items():
            try:
                rpc_url = getattr(settings, chain.rpc_url_env.lower(), None)
                if not rpc_url:
                    self.print_result(f"{chain_name} RPC", False, "Not configured")
                    results[chain_name] = {'status': False, 'message': 'Not configured'}
                    continue
                
                if chain.chain_type == ChainType.SOLANA:
                    payload = {"jsonrpc": "2.0", "method": "getHealth", "id": 1}
                else:
                    payload = {"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1}
                
                import time
                start = time.time()
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(rpc_url, json=payload, timeout=5) as resp:
                        latency = (time.time() - start) * 1000
                        
                        if resp.status == 200:
                            self.print_result(
                                f"{chain_name} RPC",
                                True,
                                f"OK ({latency:.0f}ms)"
                            )
                            results[chain_name] = {
                                'status': True,
                                'message': f"OK ({latency:.0f}ms)",
                                'latency': latency
                            }
                        else:
                            self.print_result(
                                f"{chain_name} RPC",
                                False,
                                f"HTTP {resp.status}"
                            )
                            results[chain_name] = {
                                'status': False,
                                'message': f"HTTP {resp.status}"
                            }
                            
            except asyncio.TimeoutError:
                self.print_result(f"{chain_name} RPC", False, "Timeout")
                results[chain_name] = {'status': False, 'message': 'Timeout'}
            except Exception as e:
                self.print_result(f"{chain_name} RPC", False, f"Error: {str(e)[:50]}")
                results[chain_name] = {'status': False, 'message': f"Error: {str(e)[:50]}"}
        
        self.results['rpc_endpoints'] = results
        return all(r['status'] for r in results.values())

    async def check_external_apis(self):
        """Check external API connectivity."""
        self.print_header("External APIs Health Check")
        
        results = {}
        
        # Check Li.Fi
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get("https://li.quest/v1/chains", timeout=5) as resp:
                    status = resp.status == 200
                    self.print_result("Li.Fi API", status, "OK" if status else f"HTTP {resp.status}")
                    results['Li.Fi'] = {'status': status, 'message': 'OK' if status else f'HTTP {resp.status}'}
        except Exception as e:
            self.print_result("Li.Fi API", False, f"Error: {str(e)[:50]}")
            results['Li.Fi'] = {'status': False, 'message': f"Error: {str(e)[:50]}"}
        
        # Check Jupiter
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000",
                    timeout=5
                ) as resp:
                    status = resp.status == 200
                    self.print_result("Jupiter API", status, "OK" if status else f"HTTP {resp.status}")
                    results['Jupiter'] = {'status': status, 'message': 'OK' if status else f'HTTP {resp.status}'}
        except Exception as e:
            self.print_result("Jupiter API", False, f"Error: {str(e)[:50]}")
            results['Jupiter'] = {'status': False, 'message': f"Error: {str(e)[:50]}"}
        
        # Check CoinGecko
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get("https://api.coingecko.com/api/v3/ping", timeout=5) as resp:
                    status = resp.status == 200
                    self.print_result("CoinGecko API", status, "OK" if status else f"HTTP {resp.status}")
                    results['CoinGecko'] = {'status': status, 'message': 'OK' if status else f'HTTP {resp.status}'}
        except Exception as e:
            self.print_result("CoinGecko API", False, f"Error: {str(e)[:50]}")
            results['CoinGecko'] = {'status': False, 'message': f"Error: {str(e)[:50]}"}
        
        self.results['external_apis'] = results
        return all(r['status'] for r in results.values())

    def check_caches(self):
        """Check cache systems."""
        self.print_header("Cache Systems Health Check")
        
        results = {}
        
        try:
            price_stats = price_cache.stats()
            self.print_result(
                "Price Cache",
                True,
                f"{price_stats['active_entries']} entries"
            )
            results['price'] = {
                'status': True,
                'message': f"{price_stats['active_entries']} entries",
                'entries': price_stats['active_entries']
            }
        except Exception as e:
            self.print_result("Price Cache", False, f"Error: {str(e)}")
            results['price'] = {'status': False, 'message': f"Error: {str(e)}"}
        
        try:
            quote_stats = quote_cache.stats()
            self.print_result(
                "Quote Cache",
                True,
                f"{quote_stats['active_entries']} entries"
            )
            results['quote'] = {
                'status': True,
                'message': f"{quote_stats['active_entries']} entries",
                'entries': quote_stats['active_entries']
            }
        except Exception as e:
            self.print_result("Quote Cache", False, f"Error: {str(e)}")
            results['quote'] = {'status': False, 'message': f"Error: {str(e)}"}
        
        try:
            balance_stats = balance_cache.stats()
            self.print_result(
                "Balance Cache",
                True,
                f"{balance_stats['active_entries']} entries"
            )
            results['balance'] = {
                'status': True,
                'message': f"{balance_stats['active_entries']} entries",
                'entries': balance_stats['active_entries']
            }
        except Exception as e:
            self.print_result("Balance Cache", False, f"Error: {str(e)}")
            results['balance'] = {'status': False, 'message': f"Error: {str(e)}"}
        
        try:
            gas_stats = gas_cache.stats()
            self.print_result(
                "Gas Cache",
                True,
                f"{gas_stats['active_entries']} entries"
            )
            results['gas'] = {
                'status': True,
                'message': f"{gas_stats['active_entries']} entries",
                'entries': gas_stats['active_entries']
            }
        except Exception as e:
            self.print_result("Gas Cache", False, f"Error: {str(e)}")
            results['gas'] = {'status': False, 'message': f"Error: {str(e)}"}
        
        self.results['caches'] = results
        return all(r['status'] for r in results.values())

    def check_configuration(self):
        """Check configuration settings."""
        self.print_header("Configuration Health Check")
        
        results = {}
        
        # Check Telegram bot token
        if not settings.telegram_bot_token or settings.telegram_bot_token == "your_bot_token_here":
            self.print_result("Telegram Bot Token", False, "Not configured")
            results['telegram_bot_token'] = {'status': False, 'message': 'Not configured'}
        else:
            self.print_result("Telegram Bot Token", True, "Configured")
            results['telegram_bot_token'] = {'status': True, 'message': 'Configured'}
        
        # Check encryption key
        if not settings.encryption_key or settings.encryption_key == "your_64_character_hex_key_here":
            self.print_result("Encryption Key", False, "Not configured")
            results['encryption_key'] = {'status': False, 'message': 'Not configured'}
        else:
            if len(settings.encryption_key) == 64:
                self.print_result("Encryption Key", True, "Configured (64 chars)")
                results['encryption_key'] = {'status': True, 'message': 'Configured (64 chars)'}
            else:
                self.print_result("Encryption Key", False, f"Invalid length: {len(settings.encryption_key)} chars")
                results['encryption_key'] = {'status': False, 'message': f"Invalid length: {len(settings.encryption_key)} chars"}
        
        # Check database URL
        if not settings.database_url:
            self.print_result("Database URL", False, "Not configured")
            results['database_url'] = {'status': False, 'message': 'Not configured'}
        else:
            self.print_result("Database URL", True, "Configured")
            results['database_url'] = {'status': True, 'message': 'Configured'}
        
        self.results['configuration'] = results
        return all(r['status'] for r in results.values())

    def print_summary(self):
        """Print health check summary."""
        self.print_header("Health Check Summary")
        
        duration = (datetime.utcnow() - self.start_time).total_seconds()
        
        # Count total checks
        total_checks = 0
        passed_checks = 0
        
        for component, data in self.results.items():
            if component == 'overall':
                continue
            if isinstance(data, dict):
                if 'status' in data:
                    total_checks += 1
                    if data['status']:
                        passed_checks += 1
                elif isinstance(data, dict):
                    for sub_component, sub_data in data.items():
                        if isinstance(sub_data, dict) and 'status' in sub_data:
                            total_checks += 1
                            if sub_data['status']:
                                passed_checks += 1
        
        # Determine overall status
        if passed_checks == total_checks:
            overall_status = True
            overall_message = "All checks passed!"
            status_icon = "✅"
            status_color = GREEN
        elif passed_checks >= total_checks * 0.8:
            overall_status = True
            overall_message = f"Most checks passed ({passed_checks}/{total_checks})"
            status_icon = "⚠️"
            status_color = YELLOW
        else:
            overall_status = False
            overall_message = f"Some checks failed ({passed_checks}/{total_checks})"
            status_icon = "❌"
            status_color = RED
        
        self.results['overall'] = overall_status
        
        print(f"\n{status_color}{status_icon} Overall Status: {overall_message}{RESET}")
        print(f"{BLUE}Duration: {duration:.2f} seconds{RESET}")
        print(f"{BLUE}Checks: {passed_checks}/{total_checks} passed{RESET}")
        
        # Exit code
        exit_code = 0 if overall_status else 1
        return exit_code

    async def run_all_checks(self):
        """Run all health checks."""
        self.print_header("Suwappu Bot Health Check")
        print(f"{BLUE}Started at: {self.start_time.strftime('%Y-%m-%d %H:%M:%S UTC')}{RESET}")
        
        # Run synchronous checks first
        db_ok = self.check_database()
        config_ok = self.check_configuration()
        cache_ok = self.check_caches()
        
        # Run async checks
        rpc_ok = await self.check_rpc_endpoints()
        api_ok = await self.check_external_apis()
        
        # Print summary and return exit code
        return self.print_summary()


def main():
    """Main entry point."""
    # Load environment variables
    if os.path.exists('.env'):
        from dotenv import load_dotenv
        load_dotenv()
    
    # Create health checker
    checker = HealthCheck()
    
    # Run all checks
    exit_code = asyncio.run(checker.run_all_checks())
    
    sys.exit(exit_code)


if __name__ == "__main__":
    main()
