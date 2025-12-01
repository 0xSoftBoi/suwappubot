"""Web3 connection pool for faster RPC calls."""

from typing import Dict
from web3 import Web3
from web3.middleware import geth_poa_middleware

from bot.config.chains import CHAINS, get_chain_by_name
from bot.config.settings import settings


class Web3Pool:
    """Pool of Web3 connections for each chain."""
    
    _instances: Dict[str, Web3] = {}
    
    @classmethod
    def get(cls, chain_name: str) -> Web3:
        """Get a Web3 instance for the specified chain."""
        if chain_name not in cls._instances:
            chain = get_chain_by_name(chain_name)
            if not chain:
                raise ValueError(f"Unknown chain: {chain_name}")
            
            # Get RPC URL
            rpc_url = cls._get_rpc_url(chain_name)
            
            # Create Web3 instance
            web3 = Web3(Web3.HTTPProvider(
                rpc_url,
                request_kwargs={
                    'timeout': 30,
                    'headers': {'Content-Type': 'application/json'}
                }
            ))
            
            # Add PoA middleware for chains that need it
            if chain_name in ['bsc', 'polygon', 'arbitrum', 'optimism', 'base']:
                web3.middleware_onion.inject(geth_poa_middleware, layer=0)
            
            cls._instances[chain_name] = web3
        
        return cls._instances[chain_name]
    
    @classmethod
    def _get_rpc_url(cls, chain_name: str) -> str:
        """Get RPC URL for chain."""
        rpc_map = {
            'ethereum': settings.ethereum_rpc_url,
            'bsc': settings.bsc_rpc_url,
            'polygon': settings.polygon_rpc_url,
            'arbitrum': settings.arbitrum_rpc_url,
            'optimism': settings.optimism_rpc_url,
            'base': settings.base_rpc_url,
        }
        
        url = rpc_map.get(chain_name)
        if not url:
            chain = get_chain_by_name(chain_name)
            url = chain.rpc_url if chain else None
        
        if not url:
            raise ValueError(f"No RPC URL for chain: {chain_name}")
        
        return url
    
    @classmethod
    def preload(cls):
        """Preload Web3 connections for all chains."""
        for chain_name in ['ethereum', 'bsc', 'polygon', 'arbitrum', 'optimism', 'base']:
            try:
                cls.get(chain_name)
            except Exception:
                pass  # Skip chains without RPC


# Singleton instance
web3_pool = Web3Pool()

