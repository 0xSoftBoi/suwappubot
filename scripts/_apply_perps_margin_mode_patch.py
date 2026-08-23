from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load(path: str) -> str:
    return (ROOT / path).read_text()


def save(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_after(text: str, anchor: str, old: str, new: str, label: str) -> str:
    start = text.find(anchor)
    if start < 0:
        raise RuntimeError(f"{label}: anchor not found")
    idx = text.find(old, start)
    if idx < 0:
        raise RuntimeError(f"{label}: target not found after anchor")
    return text[:idx] + new + text[idx + len(old) :]


# --- Terminal request type -------------------------------------------------
path = "terminal/src/types/api.ts"
text = load(path)
text = replace_once(
    text,
    "  leverage: number\n  orderType?: PerpsOrderType\n",
    "  leverage: number\n  marginMode?: 'cross' | 'isolated'\n  orderType?: PerpsOrderType\n",
    "PerpsExecuteParams.marginMode",
)
save(path, text)


# --- Pure leverage helpers -------------------------------------------------
(ROOT / "terminal/src/lib/perpsRisk.ts").write_text(
    """export const DEFAULT_MAX_LEVERAGE = 20

export function normalizeMaxLeverage(maxLeverage: number | null | undefined): number {
  if (!Number.isFinite(maxLeverage) || (maxLeverage as number) < 1) return DEFAULT_MAX_LEVERAGE
  return Math.max(1, Math.trunc(maxLeverage as number))
}

export function clampLeverage(value: number, maxLeverage: number | null | undefined): number {
  const max = normalizeMaxLeverage(maxLeverage)
  const finite = Number.isFinite(value) ? Math.trunc(value) : 1
  return Math.min(Math.max(finite, 1), max)
}

export function isLeverageValid(value: number, maxLeverage: number | null | undefined): boolean {
  const max = normalizeMaxLeverage(maxLeverage)
  return Number.isInteger(value) && value >= 1 && value <= max
}
"""
)

(ROOT / "terminal/src/lib/perpsRisk.test.ts").write_text(
    """import { describe, expect, it } from 'bun:test'
import { clampLeverage, isLeverageValid, normalizeMaxLeverage } from './perpsRisk'

describe('perps leverage bounds', () => {
  it('clamps persisted leverage when switching to a lower-cap market', () => {
    expect(clampLeverage(50, 20)).toBe(20)
    expect(clampLeverage(10, 5)).toBe(5)
  })

  it('never permits leverage below 1x or non-finite values', () => {
    expect(clampLeverage(0, 20)).toBe(1)
    expect(clampLeverage(Number.NaN, 20)).toBe(1)
  })

  it('uses the conservative fallback only when market metadata is invalid', () => {
    expect(normalizeMaxLeverage(undefined)).toBe(20)
    expect(normalizeMaxLeverage(0)).toBe(20)
    expect(normalizeMaxLeverage(7.9)).toBe(7)
  })

  it('blocks submission outside the selected market leverage range', () => {
    expect(isLeverageValid(1, 5)).toBe(true)
    expect(isLeverageValid(5, 5)).toBe(true)
    expect(isLeverageValid(6, 5)).toBe(false)
    expect(isLeverageValid(1.5, 5)).toBe(false)
  })
})
"""
)


# --- Perps ticket ----------------------------------------------------------
path = "terminal/src/components/perps/PerpsPanel.tsx"
text = load(path)
text = replace_once(text, "import { useState } from 'react'", "import { useEffect, useState } from 'react'", "PerpsPanel useEffect import")
text = replace_once(
    text,
    "import type { MarginMode } from '../../types/perps'\n",
    "import type { MarginMode } from '../../types/perps'\nimport { clampLeverage, isLeverageValid, normalizeMaxLeverage } from '../../lib/perpsRisk'\n",
    "PerpsPanel risk import",
)
text = replace_once(
    text,
    "  const market = markets?.find((m: HLMarket) => m.name === selectedMarket)\n  const funding = usePerpsFunding(market)\n",
    "  const market = markets?.find((m: HLMarket) => m.name === selectedMarket)\n  const maxLeverage = normalizeMaxLeverage(market?.maxLeverage)\n  const funding = usePerpsFunding(market)\n\n  // A persisted leverage can become invalid when the market changes. Keep the\n  // ticket bounded immediately; the backend still re-checks live HL metadata.\n  useEffect(() => {\n    setLeverage((current) => {\n      const bounded = clampLeverage(current, maxLeverage)\n      return bounded === current ? current : bounded\n    })\n  }, [maxLeverage, setLeverage])\n",
    "PerpsPanel market leverage clamp",
)
text = replace_once(
    text,
    "  const liqPrice =\n    refPrice > 0 && leverage > 0 && mmf > 0 && mmf < 1\n",
    "  const liqPrice =\n    marginMode === 'isolated' && refPrice > 0 && leverage > 0 && mmf > 0 && mmf < 1\n",
    "PerpsPanel isolated liquidation estimate",
)
text = replace_once(
    text,
    "  const canSubmit =\n    isAuthenticated &&\n    !needsTradingProof &&\n    connected &&\n    market &&\n    sizeNum > 0 &&\n    limitValid &&\n    !execute.isPending\n",
    "  const leverageValid = isLeverageValid(leverage, maxLeverage)\n  const canSubmit =\n    isAuthenticated &&\n    !needsTradingProof &&\n    connected &&\n    market &&\n    sizeNum > 0 &&\n    leverageValid &&\n    limitValid &&\n    !execute.isPending\n",
    "PerpsPanel submit eligibility",
)
text = replace_once(
    text,
    "    if (!market || !(sizeNum > 0)) return\n    if (isLimit && !(limitNum > 0)) return\n",
    "    if (!market || !(sizeNum > 0)) return\n    if (!leverageValid) return\n    if (isLimit && !(limitNum > 0)) return\n",
    "PerpsPanel submit leverage guard",
)
text = replace_once(text, "        leverage,\n        orderType,\n", "        leverage,\n        marginMode,\n        orderType,\n", "PerpsPanel margin mode request")
text = replace_once(
    text,
    "          max={market?.maxLeverage || 20}\n          value={leverage}\n          onChange={(e) => setLeverage(parseInt(e.target.value))}\n",
    "          max={maxLeverage}\n          value={leverage}\n          onChange={(e) => setLeverage(clampLeverage(parseInt(e.target.value), maxLeverage))}\n",
    "PerpsPanel leverage slider",
)
text = replace_once(text, "          <span>{market?.maxLeverage || 20}×</span>\n", "          <span>{maxLeverage}×</span>\n", "PerpsPanel leverage cap label")
save(path, text)


# --- Python terminal request contract -------------------------------------
path = "api/routes/terminal.py"
text = load(path)
text = replace_once(
    text,
    "    leverage: int = 1\n    orderType: str = \"market\"  # \"market\" | \"limit\"\n",
    "    leverage: int = 1\n    marginMode: str = \"cross\"  # \"cross\" | \"isolated\"\n    orderType: str = \"market\"  # \"market\" | \"limit\"\n",
    "PerpsExecuteBody.marginMode",
)
text = replace_after(
    text,
    '@router.post("/perps/execute")',
    "    is_limit = (body.orderType or \"market\").lower() == \"limit\"\n\n    try:\n",
    "    order_type = (body.orderType or \"market\").strip().lower()\n    if order_type not in (\"market\", \"limit\"):\n        raise HTTPException(status_code=400, detail=\"orderType must be market or limit.\")\n    margin_mode = (body.marginMode or \"cross\").strip().lower()\n    if margin_mode not in (\"cross\", \"isolated\"):\n        raise HTTPException(status_code=400, detail=\"marginMode must be cross or isolated.\")\n    is_limit = order_type == \"limit\"\n\n    try:\n",
    "terminal perps mode validation",
)
text = replace_after(
    text,
    '@router.post("/perps/execute")',
    "                leverage=body.leverage,\n            )\n",
    "                leverage=body.leverage,\n                margin_mode=margin_mode,\n            )\n",
    "terminal limit mode forwarding",
)
text = replace_after(
    text,
    "        pos = await perps_service.open_position(",
    "            leverage=body.leverage,\n            tp_price=body.tpPrice,\n",
    "            leverage=body.leverage,\n            tp_price=body.tpPrice,\n            margin_mode=margin_mode,\n",
    "terminal market mode forwarding",
)
save(path, text)


# --- Service boundary ------------------------------------------------------
path = "bot/services/perps_service.py"
text = load(path)
text = replace_after(
    text,
    "    async def open_position(",
    "        sl_price: Optional[float] = None,\n    ) -> Optional[PerpPosition]:\n",
    "        sl_price: Optional[float] = None,\n        margin_mode: str = \"cross\",\n    ) -> Optional[PerpPosition]:\n",
    "open_position signature",
)
text = replace_after(
    text,
    "    async def open_position(",
    "        if side not in (\"long\", \"short\"):\n            raise ValueError(\"Side must be 'long' or 'short'\")\n\n",
    "        if side not in (\"long\", \"short\"):\n            raise ValueError(\"Side must be 'long' or 'short'\")\n        margin_mode = (margin_mode or \"cross\").strip().lower()\n        if margin_mode not in (\"cross\", \"isolated\"):\n            raise ValueError(\"Margin mode must be 'cross' or 'isolated'\")\n\n",
    "open_position mode validation",
)
text = replace_after(
    text,
    "    async def open_position(",
    "            leverage=leverage,\n            order_type=\"market\",\n",
    "            leverage=leverage,\n            order_type=\"market\",\n            is_cross=margin_mode == \"cross\",\n",
    "open_position mode forwarding",
)
text = replace_after(
    text,
    "    async def place_limit_order(",
    "        leverage: int = 1,\n    ) -> Optional[PerpOrder]:\n",
    "        leverage: int = 1,\n        margin_mode: str = \"cross\",\n    ) -> Optional[PerpOrder]:\n",
    "place_limit_order signature",
)
text = replace_after(
    text,
    "    async def place_limit_order(",
    "        if side not in (\"long\", \"short\"):\n            raise ValueError(\"Side must be 'long' or 'short'\")\n",
    "        if side not in (\"long\", \"short\"):\n            raise ValueError(\"Side must be 'long' or 'short'\")\n        margin_mode = (margin_mode or \"cross\").strip().lower()\n        if margin_mode not in (\"cross\", \"isolated\"):\n            raise ValueError(\"Margin mode must be 'cross' or 'isolated'\")\n",
    "place_limit_order mode validation",
)
text = replace_after(
    text,
    "    async def place_limit_order(",
    "            leverage=leverage,\n            order_type=\"limit\",\n",
    "            leverage=leverage,\n            order_type=\"limit\",\n            is_cross=margin_mode == \"cross\",\n",
    "place_limit_order mode forwarding",
)
save(path, text)


# --- HyperLiquid wire semantics -------------------------------------------
path = "bot/services/hyperliquid_client.py"
text = load(path)
text = replace_after(
    text,
    "    async def place_order(",
    "        builder_fee_tenths_bps: Optional[int] = None,\n    ) -> Optional[HLOrderResult]:\n",
    "        builder_fee_tenths_bps: Optional[int] = None,\n        is_cross: bool = True,\n    ) -> Optional[HLOrderResult]:\n",
    "HyperLiquid place_order signature",
)
text = replace_after(
    text,
    "    async def place_order(",
    "            # Set leverage\n            await self._set_leverage(client, address, api_key, api_secret, asset, leverage)\n\n",
    "            # Margin mode/leverage is an entry setting. A reduce-only close or\n            # TP/SL must never mutate account leverage as a side effect.\n            if not reduce_only and order_type in (\"market\", \"limit\"):\n                await self._set_leverage(\n                    client, address, api_key, api_secret, asset, leverage, is_cross=is_cross\n                )\n\n",
    "HyperLiquid entry-only leverage update",
)
old = """    async def _set_leverage(
        self,
        client: httpx.AsyncClient,
        address: str,
        api_key: str,
        api_secret: str,
        asset: str,
        leverage: int,
    ):
        \"\"\"Set leverage for an asset.\"\"\"
        try:
            action = {
                \"type\": \"updateLeverage\",
                \"asset\": await self._resolve_asset_index(asset),
                \"isCross\": True,
                \"leverage\": leverage,
            }

            nonce = int(time.time() * 1000)

            await client.post(
                self.EXCHANGE_URL,
                json={
                    \"action\": action,
                    \"nonce\": nonce,
                    \"signature\": self._sign_action(action, nonce, api_secret),
                    \"vaultAddress\": None,
                },
                headers={\"Authorization\": f\"Bearer {api_key}\"},
            )
        except Exception as e:
            logger.warning(f\"Failed to set leverage: {e}\")
"""
new = """    async def _set_leverage(
        self,
        client: httpx.AsyncClient,
        address: str,
        api_key: str,
        api_secret: str,
        asset: str,
        leverage: int,
        is_cross: bool = True,
    ) -> None:
        \"\"\"Set entry leverage + margin mode, failing closed on rejection.\"\"\"
        action = {
            \"type\": \"updateLeverage\",
            \"asset\": await self._resolve_asset_index(asset),
            \"isCross\": bool(is_cross),
            \"leverage\": leverage,
        }
        nonce = int(time.time() * 1000)
        try:
            response = await client.post(
                self.EXCHANGE_URL,
                json={
                    \"action\": action,
                    \"nonce\": nonce,
                    \"signature\": self._sign_action(action, nonce, api_secret),
                    \"vaultAddress\": None,
                },
                headers={\"Authorization\": f\"Bearer {api_key}\"},
            )
            if response.status_code != 200:
                raise RuntimeError(
                    f\"HyperLiquid leverage update failed: HTTP {response.status_code} \"
                    f\"{getattr(response, 'text', '')[:200]}\"
                )
            data = response.json()
            if data.get(\"status\") != \"ok\":
                raise RuntimeError(f\"HyperLiquid rejected leverage/margin mode update: {data}\")
        except Exception as e:
            logger.error(
                \"Failed to set %s %sx leverage for %s: %s\",
                \"cross\" if is_cross else \"isolated\",
                leverage,
                asset,
                e,
            )
            raise
"""
text = replace_once(text, old, new, "HyperLiquid _set_leverage")
save(path, text)

print("perps margin-mode patch applied")
