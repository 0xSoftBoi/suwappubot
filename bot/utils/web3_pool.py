"""Web3 connection pool — thin wrapper delegating to RPCManager."""

from web3 import Web3


class Web3Pool:
    """Pool of Web3 connections, backed by RPCManager."""

    @classmethod
    def get(cls, chain_name: str) -> Web3:
        """Get a Web3 instance for the specified chain."""
        from bot.services.rpc_manager import rpc_manager

        return rpc_manager.get_web3(chain_name)

    @classmethod
    def preload(cls):
        """No-op — RPCManager handles preloading."""


# Singleton instance
web3_pool = Web3Pool()
