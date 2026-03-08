import subprocess
import time
import requests
import signal
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class ForkManager:
    """Manages a local Anvil fork of a blockchain."""
    
    def __init__(self, rpc_url: str, port: int = 8545):
        self.rpc_url = rpc_url
        self.port = port
        self.process: Optional[subprocess.Popen] = None
        self.local_url = f"http://127.0.0.1:{port}"

    def start(self):
        """Start the Anvil fork."""
        cmd = [
            "anvil",
            "--fork-url", self.rpc_url,
            "--port", str(self.port),
            "--auto-impersonate"  # Allow transactions from any account without private key
        ]
        
        logger.info(f"Starting Anvil fork: {' '.join(cmd)}")
        self.process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=os.setsid  # Create new process group
        )
        
        # Wait for Anvil to be ready
        retries = 60  # 30 seconds
        for _ in range(retries):
            # Check if process died
            if self.process.poll() is not None:
                out, err = self.process.communicate()
                out_str = out.decode('utf-8') if out else ""
                err_str = err.decode('utf-8') if err else ""
                raise RuntimeError(f"Anvil died immediately. Stdout: {out_str}, Stderr: {err_str}")

            try:
                response = requests.post(
                    self.local_url,
                    json={"jsonrpc": "2.0", "method": "eth_blockNumber", "params": [], "id": 1},
                    timeout=1
                )
                if response.status_code == 200:
                    logger.info("Anvil fork is ready")
                    return
            except requests.exceptions.RequestException:
                time.sleep(0.5)
        
        # Timeout occurred
        self.stop()
        if self.process:
            out, err = self.process.communicate()
            out_str = out.decode('utf-8') if out else ""
            err_str = err.decode('utf-8') if err else ""
            raise RuntimeError(f"Failed to start Anvil fork (timeout). Stdout: {out_str}, Stderr: {err_str}")
        raise RuntimeError("Failed to start Anvil fork")

    def stop(self):
        """Stop the Anvil fork."""
        if self.process:
            logger.info("Stopping Anvil fork")
            try:
                os.killpg(os.getpgid(self.process.pid), signal.SIGTERM)
            except ProcessLookupError:
                pass
            self.process.wait()
            self.process = None

    def impersonate_account(self, address: str):
        """Impersonate an account (should happen automatically with --auto-impersonate, but good to have explicit call)."""
        response = requests.post(
            self.local_url,
            json={
                "jsonrpc": "2.0",
                "method": "anvil_impersonateAccount",
                "params": [address],
                "id": 1
            }
        )
        if response.status_code != 200 or "error" in response.json():
            raise RuntimeError(f"Failed to impersonate {address}: {response.text}")

    def set_balance(self, address: str, amount_wei: int):
        """Set ETH balance of an account."""
        response = requests.post(
            self.local_url,
            json={
                "jsonrpc": "2.0",
                "method": "anvil_setBalance",
                "params": [address, hex(amount_wei)],
                "id": 1
            }
        )
        if response.status_code != 200:
            raise RuntimeError(f"Failed to set balance for {address}")

    def set_code(self, address: str, code: str):
        """Set code at an address (useful for mocking contracts if needed)."""
        requests.post(
            self.local_url,
            json={
                "jsonrpc": "2.0",
                "method": "anvil_setCode",
                "params": [address, code],
                "id": 1
            }
        )
