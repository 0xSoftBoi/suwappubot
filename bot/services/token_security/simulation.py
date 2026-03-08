"""Deep State Simulation for Solana honeypot detection."""

import logging
import asyncio
import base64
from typing import Optional, Dict, Any, List
from solders.pubkey import Pubkey
from solders.instruction import Instruction, AccountMeta
from solders.message import MessageV0
from solders.transaction import VersionedTransaction
from solana.rpc.async_api import AsyncClient as SolanaClient

from bot.config.settings import settings
from bot.services.jupiter_api import JupiterAPI
from bot.utils.http_client import get_session

logger = logging.getLogger(__name__)

# Wrapped SOL
WSOL_MINT = "So11111111111111111111111111111111111111112"


class SimulationService:
    """Simulates multi-step Solana transactions to detect honeypots."""
    
    def __init__(self):
        self.jupiter = JupiterAPI()
        self._solana_client: Optional[SolanaClient] = None
        self._cache: Dict[str, tuple[Dict[str, Any], datetime]] = {}
        self._cache_ttl = 60 # 1 minute cache

    async def _get_client(self) -> SolanaClient:
        if self._solana_client is None:
            self._solana_client = SolanaClient(settings.solana_rpc_url)
        return self._solana_client

    async def simulate_swap_cycle(
        self,
        token_mint: str,
        amount_sol: float,
        user_pubkey: str,
    ) -> Dict[str, Any]:
        """
        Simulate Buy -> Sell cycle.
        """
        # Check cache
        if token_mint in self._cache:
            res, ts = self._cache[token_mint]
            if (datetime.utcnow() - ts).total_seconds() < self._cache_ttl:
                return res

        try:
            client = await self._get_client()
            amount_lamports = int(amount_sol * 1e9)
            
            # 1. Get Buy Quote + Instructions
            buy_quote = await self.jupiter.get_quote(
                input_mint=WSOL_MINT,
                output_mint=token_mint,
                amount=str(amount_lamports),
                slippage_bps=100, # 1% slippage for simulation
            )
            
            buy_ixs = await self.jupiter.get_swap_instructions(
                quote_response=buy_quote.raw_response,
                user_public_key=user_pubkey,
            )
            
            # 2. Estimate tokens received and get Sell Quote + Instructions
            tokens_received = buy_quote.out_amount
            
            sell_quote = await self.jupiter.get_quote(
                input_mint=token_mint,
                output_mint=WSOL_MINT,
                amount=tokens_received,
                slippage_bps=100,
            )
            
            sell_ixs = await self.jupiter.get_swap_instructions(
                quote_response=sell_quote.raw_response,
                user_public_key=user_pubkey,
            )
            
            # 3. Build combined message instructions
            all_instructions = self._parse_jupiter_instructions(buy_ixs)
            all_instructions.extend(self._parse_jupiter_instructions(sell_ixs))
            
            # 4. Build and Simulate
            # We use a dummy blockhash as we are just simulating
            recent_blockhash_resp = await client.get_latest_blockhash()
            recent_blockhash = recent_blockhash_resp.value.blockhash
            
            # Address Lookup Tables (ALTs) are required for versioned transactions
            # We merge ALTs from buy and sell
            lookup_tables = self._get_unique_lookup_tables(buy_ixs, sell_ixs)
            
            # Fetch lookups
            lookup_table_accounts = []
            for lt_addr in lookup_tables:
                lt_pubkey = Pubkey.from_string(lt_addr)
                alt_resp = await client.get_address_lookup_table(lt_pubkey)
                if alt_resp.value:
                    lookup_table_accounts.append(alt_resp.value)
            
            message = MessageV0.try_compile(
                payer=Pubkey.from_string(user_pubkey),
                instructions=all_instructions,
                address_lookup_table_accounts=lookup_table_accounts,
                recent_blockhash=recent_blockhash,
            )
            
            tx = VersionedTransaction(message, []) # No signatures needed for simulation
            
            # Note: We use simulate_transaction with replace_recent_blockhash=True
            sim_resp = await client.simulate_transaction(tx, replace_recent_blockhash=True)
            
            if sim_resp.value.err:
                logger.warning(f"Simulation failed for {token_mint}: {sim_resp.value.err}")
                return {
                    "is_safe": False,
                    "reason": "simulation_failed",
                    "error": str(sim_resp.value.err),
                    "logs": sim_resp.value.logs
                }
            
            # Analysis of logs/balance could go here for even deeper checks
            # For now, if it completes Buy->Sell without revert, it's 95% likely safe.
            
            result = {
                "is_safe": True,
                "buy_out": int(tokens_received),
                "sell_out": int(sell_quote.out_amount),
                "expected_sol_back": float(sell_quote.out_amount) / 1e9,
                "price_impact": buy_quote.price_impact_pct + sell_quote.price_impact_pct,
            }
            
            self._cache[token_mint] = (result, datetime.utcnow())
            return result
            
        except Exception as e:
            logger.error(f"Deep Simulation error for {token_mint}: {e}")
            return {"is_safe": False, "reason": "error", "error": str(e)}

    def _parse_jupiter_instructions(self, jup_resp: dict) -> List[Instruction]:
        """Convert Jupiter raw instructions into solders.Instruction objects."""
        ixs = []
        
        # Keys to process in order
        sections = [
            "computeBudgetInstructions",
            "setupInstructions",
            "swapInstruction",
            "cleanupInstruction"
        ]
        
        for section in sections:
            data = jup_resp.get(section)
            if not data:
                continue
                
            if isinstance(data, list):
                for item in data:
                    ixs.append(self._create_ix(item))
            else:
                ixs.append(self._create_ix(data))
                
        return ixs

    def _create_ix(self, data: dict) -> Instruction:
        """Create solders Instruction from Jupiter dict."""
        return Instruction(
            program_id=Pubkey.from_string(data["programId"]),
            accounts=[
                AccountMeta(
                    pubkey=Pubkey.from_string(acc["pubkey"]),
                    is_signer=acc["isSigner"],
                    is_writable=acc["isWritable"]
                ) for acc in data["accounts"]
            ],
            data=base64.b64decode(data["data"])
        )

    def _get_unique_lookup_tables(self, buy: dict, sell: dict) -> List[str]:
        """Extract unique address lookup tables from both responses."""
        tables = set()
        tables.update(buy.get("addressLookupTableAddresses", []))
        tables.update(sell.get("addressLookupTableAddresses", []))
        return list(tables)


# Global instance
simulation_service = SimulationService()
