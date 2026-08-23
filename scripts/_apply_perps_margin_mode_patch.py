from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text)


def replace_once(text: str, old: str, new: str, *, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_after(text: str, anchor: str, old: str, new: str, *, label: str) -> str:
    start = text.find(anchor)
    if start < 0:
        raise RuntimeError(f"{label}: anchor not found")
    idx = text.find(old, start)
    if idx < 0:
        raise RuntimeError(f"{label}: target not found after anchor")
    return text[:idx] + new + text[idx + len(old) :]


# Terminal API contract -----------------------------------------------------
path = "terminal/src/types/api.ts"
text = read(path)
text = replace_once(
    text,
    "  leverage: number\n  orderType?: PerpsOrderType\n",
    "  leverage: number\n  marginMode?: 'cross' | 'isolated'\n  orderType?: PerpsOrderType\n",
    label="PerpsExecuteParams.marginMode",
)
write(path, text)


# Pure leverage-risk helpers: testable without rendering React --------------
risk_path = ROOT / "terminal/src/lib/perpsRisk.ts"
risk_path.write_text(
    """export const DEFAULT_MAX_LEVERAGE = 20\n\n"
    "export function normalizeMaxLeverage(maxLeverage: number | null | undefined): number {\n"
    "  if (!Number.isFinite(maxLeverage) || (maxLeverage as number) < 1) return DEFAULT_MAX_LEVERAGE\n"
    "  return Math.max(1, Math.trunc(maxLeverage as number))\n"
    "}\n\n"
    "export function clampLeverage(value: number, maxLeverage: number | null | undefined): number {\n"
    "  const max = normalizeMaxLeverage(maxLeverage)\n"
    "  const finite = Number.isFinite(value) ? Math.trunc(value) : 1\n"
    "  return Math.min(Math.max(finite, 1), max)\n"
    "}\n\n"
    "export function isLeverageValid(value: number, maxLeverage: number | null | undefined): boolean {\n"
    "  const max = normalizeMaxLeverage(maxLeverage)\n"
    "  return Number.isInteger(value) && value >= 1 && value <= max\n"
    "}\n"
)

(ROOT / "terminal/src/lib/perpsRisk.test.ts").write_text(
    """import { describe, expect, it } from 'bun:test'\n"
    "import { clampLeverage, isLeverageValid, normalizeMaxLeverage } from './perpsRisk'\n\n"
    "describe('perps leverage bounds', () => {\n"
    "  it('clamps a persisted leverage when switching to a lower-cap market', () => {\n"
    "    expect(clampLeverage(50, 20)).toBe(20)\n"
    "    expect(clampLeverage(10, 5)).toBe(5)\n"
    "  })\n\n"
    "  it('never permits leverage below 1x or non-finite values', () => {\n"
    "    expect(clampLeverage(0, 20)).toBe(1)\n"
    "    expect(clampLeverage(Number.NaN, 20)).toBe(1)\n"
    "  })\n\n"
    "  it('uses the conservative UI fallback only when market metadata is invalid', () => {\n"
    "    expect(normalizeMaxLeverage(undefined)).toBe(20)\n"
    "    expect(normalizeMaxLeverage(0)).toBe(20)\n"
    "    expect(normalizeMaxLeverage(7.9)).toBe(7)\n"
    "  })\n\n"
    "  it('blocks submission outside the selected market leverage range', () => {\n"
    "    expect(isLeverageValid(1, 5)).toBe(true)\n"
    "    expect(isLeverageValid(5, 5)).toBe(true)\n"
    "    expect(isLeverageValid(6, 5)).toBe(false)\n"
    "    expect(isLeverageValid(1.5, 5)).toBe(false)\n"
    "  })\n"
    "})\n"
)


# Perps ticket --------------------------------------------------------------
path = "terminal/src/components/perps/PerpsPanel.tsx"
text = read(path)
text = replace_once(
    text,
    "import { useState } from 'react'",
    "import { useEffect, useState } from 'react'",
    label="PerpsPanel useEffect import",
)
text = replace_once(
    text,
    "import type { MarginMode } from '../../types/perps'\n",
    "import type { MarginMode } from '../../types/perps'\n"
    "import { clampLeverage, isLeverageValid, normalizeMaxLeverage } from '../../lib/perpsRisk'\n",
    label="PerpsPanel risk import",
)
text = replace_once(
    text,
    "  const market = markets?.find((m: HLMarket) => m.name === selectedMarket)\n"
    "  const funding = usePerpsFunding(market)\n",
    "  const market = markets?.find((m: HLMarket) => m.name === selectedMarket)\n"
    "  const maxLeverage = normalizeMaxLeverage(market?.maxLeverage)\n"
    "  const funding = usePerpsFunding(market)\n\n"
    "  // Persisted leverage can be valid for one market and unsafe for the next.\n"
    "  // Clamp immediately when market metadata changes; server-side validation\n"
    "  // remains authoritative if HyperLiquid changes the cap underneath us.\n"
    "  useEffect(() => {\n"
    "    setLeverage((current) => {\n"
    "      const bounded = clampLeverage(current, maxLeverage)\n"
    "      return bounded === current ? current : bounded\n"
    "    })\n"
    "  }, [maxLeverage, setLeverage])\n",
    label="PerpsPanel leverage clamp effect",
)
text = replace_once(
    text,
    "  const liqPrice =\n"
    "    refPrice > 0 && leverage > 0 && mmf > 0 && mmf < 1\n",
    "  const liqPrice =\n"
    "    marginMode === 'isolated' && refPrice > 0 && leverage > 0 && mmf > 0 && mmf < 1\n",
    label="PerpsPanel isolated liquidation estimate",
)
text = replace_once(
    text,
    "  const canSubmit =\n"
    "    isAuthenticated &&\n"
    "    !needsTradingProof &&\n"
    "    connected &&\n"
    "    market &&\n"
    "    sizeNum > 0 &&\n"
    "    limitValid &&\n"
    "    !execute.isPending\n",
    "  const leverageValid = isLeverageValid(leverage, maxLeverage)\n"
    "  const canSubmit =\n"
    "    isAuthenticated &&\n"
    "    !needsTradingProof &&\n"
    "    connected &&\n"
    "    market &&\n"
    "    sizeNum > 0 &&\n"
    "    leverageValid &&\n"
    "    limitValid &&\n"
    "    !execute.isPending\n",
    label="PerpsPanel canSubmit leverage guard",
)
text = replace_once(
    text,
    "    if (!market || !(sizeNum > 0)) return\n"
    "    if (isLimit && !(limitNum > 0)) return\n",
    "    if (!market || !(sizeNum > 0)) return\n"
    "    if (!leverageValid) return\n"
    "    if (isLimit && !(limitNum > 0)) return\n",
    label="PerpsPanel submit leverage guard",
)
text = replace_once(
    text,
    "        leverage,\n        orderType,\n",
    "        leverage,\n        marginMode,\n        orderType,\n",
    label="PerpsPanel submit marginMode",
)
text = replace_once(
    text,
    "          max={market?.maxLeverage || 20}\n"
    "          value={leverage}\n"
    "          onChange={(e) => setLeverage(parseInt(e.target.value))}\n",
    "          max={maxLeverage}\n"
    "          value={leverage}\n"
    "          onChange={(e) => setLeverage(clampLeverage(parseInt(e.target.value), maxLeverage))}\n",
    label="PerpsPanel leverage slider clamp",
)
text = replace_once(
    text,
    "          <span>{market?.maxLeverage || 20}×</span>\n",
    "          <span>{maxLeverage}×</span>\n",
    label="PerpsPanel leverage max label",
)
write(path, text)


# Python terminal request contract -----------------------------------------
path = "api/routes/terminal.py"
text = read(path)
text = replace_once(
    text,
    "    leverage: int = 1\n    orderType: str = \"market\"  # \"market\" | \"limit\"\n",
    "    leverage: int = 1\n"
    "    marginMode: str = \"cross\"  # \"cross\" | \"isolated\"\n"
    "    orderType: str = \"market\"  # \"market\" | \"limit\"\n",
    label="PerpsExecuteBody.marginMode",
)
text = replace_after(
    text,
    '@router.post("/perps/execute")',
    "    is_limit = (body.orderType or \"market\").lower() == \"limit\"\n\n    try:\n",
    "    order_type = (body.orderType or \"market\").strip().lower()\n"
    "    if order_type not in (\"market\", \"limit\"):\n"
    "        raise HTTPException(status_code=400, detail=\"orderType must be market or limit.\")\n"
    "    margin_mode = (body.marginMode or \"cross\").strip().lower()\n"
    "    if margin_mode not in (\"cross\", \"isolated\"):\n"
    "        raise HTTPException(status_code=400, detail=\"marginMode must be cross or isolated.\")\n"
    "    is_limit = order_type == \"limit\"\n\n"
    "    try:\n",
    label="terminal perps mode validation",
)
text = replace_after(
    text,
    '@router.post("/perps/execute")',
    "                leverage=body.leverage,\n            )\n",
    "                leverage=body.leverage,\n                margin_mode=margin_mode,\n            )\n",
    label="terminal limit margin mode forwarding",
)
text = replace_after(
    text,
    "        pos = await perps_service.open_position(",
    "            leverage=body.leverage,\n            tp_price=body.tpPrice,\n",
    "            leverage=body.leverage,\n            tp_price=body.tpPrice,\n            margin_mode=margin_mode,\n",
    label="terminal market margin mode forwarding",
)
write(path, text)


# Perps service boundary ----------------------------------------------------
path = "bot/services/perps_service.py"
text = read(path)
text = replace_after(
    text,
    "    async def open_position(",
    "        sl_price: Optional[float] = None,\n    ) -> Optional[PerpPosition]:\n",
    "        sl_price: Optional[float] = None,\n        margin_mode: str = \"cross\",\n    ) -> Optional[PerpPosition]:\n",
    label="open_position margin_mode signature",
)
text = replace_after(
    text,
    "    async def open_position(",
    "        if side not in (\"long\", \"short\"):\n            raise ValueError(\"Side must be 'long' or 'short'\")\n\n",
    "        if side not in (\"long\", \"short\"):\n"
    "            raise ValueError(\"Side must be 'long' or 'short'\")\n"
    "        margin_mode = (margin_mode or \"cross\").strip().lower()\n"
    "        if margin_mode not in (\"cross\", \"isolated\"):\n"
    "            raise ValueError(\"Margin mode must be 'cross' or 'isolated'\")\n\n",
    label="open_position margin_mode validation",
)
text = replace_after(
    text,
    "    async def open_position(",
    "            leverage=leverage,\n            order_type=\"market\",\n",
    "            leverage=leverage,\n            order_type=\"market\",\n            is_cross=margin_mode == \"cross\",\n",
    label="open_position is_cross forwarding",
)
text = replace_after(
    text,
    "    async def place_limit_order(",
    "        leverage: int = 1,\n    ) -> Optional[PerpOrder]:\n",
    "        leverage: int = 1,\n        margin_mode: str = \"cross\",\n    ) -> Optional[PerpOrder]:\n",
    label="place_limit_order margin_mode signature",
)
text = replace_after(
    text,
    "    async def place_limit_order(",
    "        if side not in (\"long\", \"short\"):\n            raise ValueError(\"Side must be 'long' or 'short'\")\n",
    "        if side not in (\"long\", \"short\"):\n"
    "            raise ValueError(\"Side must be 'long' or 'short'\")\n"
    "        margin_mode = (margin_mode or \"cross\").strip().lower()\n"
    "        if margin_mode not in (\"cross\", \"isolated\"):\n"
    "            raise ValueError(\"Margin mode must be 'cross' or 'isolated'\")\n",
    label="place_limit_order margin_mode validation",
)
text = replace_after(
    text,
    "    async def place_limit_order(",
    "            leverage=leverage,\n            order_type=\"limit\",\n",
    "            leverage=leverage,\n            order_type=\"limit\",\n            is_cross=margin_mode == \"cross\",\n",
    label="place_limit_order is_cross forwarding",
)
write(path, text)


# HyperLiquid wire semantics ------------------------------------------------
path = "bot/services/hyperliquid_client.py"
text = read(path)
text = replace_after(
    text,
    "    async def place_order(",
    "        builder_fee_tenths_bps: Optional[int] = None,\n    ) -> Optional[HLOrderResult]:\n",
    "        builder_fee_tenths_bps: Optional[int] = None,\n"
    "        is_cross: bool = True,\n"
    "    ) -> Optional[HLOrderResult]:\n",
    label="HyperLiquid place_order is_cross signature",
)
text = replace_after(
    text,
    "    async def place_order(",
    "            # Set leverage\n"
    "            await self._set_leverage(client, address, api_key, api_secret, asset, leverage)\n\n",
    "            # Margin mode/leverage is an ENTRY setting. A reduce-only close or\n"
    "            # TP/SL must never mutate the account's leverage as a side effect.\n"
    "            if not reduce_only and order_type in (\"market\", \"limit\"):\n"
    "                await self._set_leverage(\n"
    "                    client, address, api_key, api_secret, asset, leverage, is_cross=is_cross\n"
    "                )\n\n",
    label="HyperLiquid entry-only leverage update",
)
old_method = '''    async def _set_leverage(\n        self,\n        client: httpx.AsyncClient,\n        address: str,\n        api_key: str,\n        api_secret: str,\n        asset: str,\n        leverage: int,\n    ):\n        \"\"\"Set leverage for an asset.\"\"\"\n        try:\n            action = {\n                \"type\": \"updateLeverage\",\n                \"asset\": await self._resolve_asset_index(asset),\n                \"isCross\": True,\n                \"leverage\": leverage,\n            }\n\n            nonce = int(time.time() * 1000)\n\n            await client.post(\n                self.EXCHANGE_URL,\n                json={\n                    \"action\": action,\n                    \"nonce\": nonce,\n                    \"signature\": self._sign_action(action, nonce, api_secret),\n                    \"vaultAddress\": None,\n                },\n                headers={\"Authorization\": f\"Bearer {api_key}\"},\n            )\n        except Exception as e:\n            logger.warning(f\"Failed to set leverage: {e}\")\n'''
new_method = '''    async def _set_leverage(\n        self,\n        client: httpx.AsyncClient,\n        address: str,\n        api_key: str,\n        api_secret: str,\n        asset: str,\n        leverage: int,\n        is_cross: bool = True,\n    ) -> None:\n        \"\"\"Set entry leverage + margin mode, failing closed on rejection.\"\"\"\n        action = {\n            \"type\": \"updateLeverage\",\n            \"asset\": await self._resolve_asset_index(asset),\n            \"isCross\": bool(is_cross),\n            \"leverage\": leverage,\n        }\n        nonce = int(time.time() * 1000)\n        try:\n            response = await client.post(\n                self.EXCHANGE_URL,\n                json={\n                    \"action\": action,\n                    \"nonce\": nonce,\n                    \"signature\": self._sign_action(action, nonce, api_secret),\n                    \"vaultAddress\": None,\n                },\n                headers={\"Authorization\": f\"Bearer {api_key}\"},\n            )\n            if response.status_code != 200:\n                raise RuntimeError(\n                    f\"HyperLiquid leverage update failed: HTTP {response.status_code} \"\n                    f\"{getattr(response, 'text', '')[:200]}\"\n                )\n            data = response.json()\n            if data.get(\"status\") != \"ok\":\n                raise RuntimeError(f\"HyperLiquid rejected leverage/margin mode update: {data}\")\n        except Exception as e:\n            logger.error(\n                \"Failed to set %s %sx leverage for %s: %s\",\n                \"cross\" if is_cross else \"isolated\",\n                leverage,\n                asset,\n                e,\n            )\n            raise\n'''
text = replace_once(text, old_method, new_method, label="HyperLiquid _set_leverage fail-closed mode")
write(path, text)


# Focused Python regression tests ------------------------------------------
(ROOT / "tests/test_perps_margin_mode.py").write_text(
    '''\"\"\"Perps margin-mode and leverage safety regression tests.\"\"\"\n\n'
    'import asyncio\n'
    'import os\n\n'
    'import pytest\n\n'
    'os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")\n'
    'os.environ.setdefault("ENCRYPTION_KEY", "test-encryption-key")\n'
    'os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")\n\n'
    'from bot.services.hyperliquid_client import HyperLiquidClient\n\n\n'
    'PK = "0x0123456789012345678901234567890123456789012345678901234567890123"\n\n\n'
    'class _Resp:\n'
    '    def __init__(self, payload, status_code=200, text=""):\n'
    '        self._payload = payload\n'
    '        self.status_code = status_code\n'
    '        self.text = text\n\n'
    '    def json(self):\n'
    '        return self._payload\n\n\n'
    'class _HTTP:\n'
    '    def __init__(self, responses):\n'
    '        self.responses = list(responses)\n'
    '        self.calls = []\n\n'
    '    async def post(self, url, json=None, headers=None):\n'
    '        self.calls.append({"url": url, "json": json, "headers": headers})\n'
    '        return self.responses.pop(0)\n\n\n'
    'def _client_with_index(index=1):\n'
    '    hl = HyperLiquidClient()\n\n'
    '    async def _index(_asset):\n'
    '        return index\n\n'
    '    hl._resolve_asset_index = _index\n'
    '    return hl\n\n\n'
    'def test_isolated_mode_serializes_is_cross_false():\n'
    '    hl = _client_with_index()\n'
    '    http = _HTTP([_Resp({"status": "ok"})])\n'
    '    asyncio.run(hl._set_leverage(http, "0xUser", "k", PK, "ETH", 7, is_cross=False))\n'
    '    action = http.calls[0]["json"]["action"]\n'
    '    assert action == {"type": "updateLeverage", "asset": 1, "isCross": False, "leverage": 7}\n\n\n'
    'def test_rejected_margin_mode_update_fails_closed():\n'
    '    hl = _client_with_index()\n'
    '    http = _HTTP([_Resp({"status": "err", "response": "cannot change margin mode"})])\n'
    '    with pytest.raises(RuntimeError, match="rejected leverage/margin mode update"):\n'
    '        asyncio.run(hl._set_leverage(http, "0xUser", "k", PK, "ETH", 5, is_cross=False))\n\n\n'
    'def test_reduce_only_close_never_mutates_leverage_or_margin_mode():\n'
    '    hl = _client_with_index()\n'
    '    http = _HTTP([\n'
    '        _Resp({"response": {"data": {"statuses": [{"filled": {"oid": 9, "avgPx": "2000", "totalSz": "0.1"}}]}}})\n'
    '    ])\n\n'
    '    async def _get_client():\n'
    '        return http\n\n'
    '    async def _mid(_market):\n'
    '        return 2000.0\n\n'
    '    async def _must_not_run(*_args, **_kwargs):\n'
    '        raise AssertionError("reduce-only order attempted to change leverage")\n\n'
    '    hl._get_client = _get_client\n'
    '    hl.get_mark_price = _mid\n'
    '    hl._set_leverage = _must_not_run\n'
    '    result = asyncio.run(\n'
    '        hl.place_order(\n'
    '            address="0xUser",\n'
    '            api_key="k",\n'
    '            api_secret=PK,\n'
    '            market="ETH-USD",\n'
    '            side="long",\n'
    '            size=0.1,\n'
    '            reduce_only=True,\n'
    '            is_cross=False,\n'
    '        )\n'
    '    )\n'
    '    assert result is not None\n'
    '    assert len(http.calls) == 1\n'
    '    assert http.calls[0]["json"]["action"]["type"] == "order"\n\n\n'
    'def test_entry_forwards_selected_margin_mode_to_leverage_update():\n'
    '    hl = _client_with_index()\n'
    '    http = _HTTP([\n'
    '        _Resp({"response": {"data": {"statuses": [{"filled": {"oid": 10, "avgPx": "2000", "totalSz": "0.1"}}]}}})\n'
    '    ])\n'
    '    seen = {}\n\n'
    '    async def _get_client():\n'
    '        return http\n\n'
    '    async def _mid(_market):\n'
    '        return 2000.0\n\n'
    '    async def _capture(*_args, **kwargs):\n'
    '        seen.update(kwargs)\n\n'
    '    hl._get_client = _get_client\n'
    '    hl.get_mark_price = _mid\n'
    '    hl._set_leverage = _capture\n'
    '    result = asyncio.run(\n'
    '        hl.place_order(\n'
    '            address="0xUser",\n'
    '            api_key="k",\n'
    '            api_secret=PK,\n'
    '            market="ETH-USD",\n'
    '            side="long",\n'
    '            size=0.1,\n'
    '            leverage=7,\n'
    '            is_cross=False,\n'
    '        )\n'
    '    )\n'
    '    assert result is not None\n'
    '    assert seen["is_cross"] is False\n'
    '''
)

print("perps margin-mode patch applied")
