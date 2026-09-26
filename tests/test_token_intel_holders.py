"""Holder-concentration measurement.

Regression cover for a live refusal: a Base token reported `top holders 101.5%`
and was refused by the autopilot's risk gate. Seven of its top ten holders were
contracts (an ERC1967Proxy, a Safe, a transparent proxy, unnamed pools), and the
balances summed to more than the reported total supply.
"""

import pytest

from bot.services.token_intel import evm_source
from bot.services.token_intel.intel_service import TokenIntelReport


def _report(supply):
    r = TokenIntelReport(token_address="0xtoken", chain="base")
    r.total_supply = supply
    return r


def _item(addr, value, is_contract=False, name=None):
    return {
        "address": {"hash": addr, "is_contract": is_contract, "name": name},
        "value": str(value),
    }


@pytest.mark.asyncio
async def test_contracts_are_not_counted_as_holders(monkeypatch):
    # The real PROS shape: 3 wallets at 15.96/13.10/5.80, the rest contracts.
    items = [
        _item("0xpool", 29_935, True),
        _item("0xwallet1", 15_959),
        _item("0xwallet2", 13_102),
        _item("0xproxy", 9_701, True, "ERC1967Proxy"),
        _item("0xsafe", 9_464, True, "SafeProxy"),
        _item("0xwallet3", 5_795),
    ]
    monkeypatch.setattr(evm_source, "_get_json", lambda *a, **k: _async({"items": items}))
    report = _report(100_000)

    await evm_source._enrich_holders(report, "https://base.blockscout.com")

    assert [h.address for h in report.top_holders] == ["0xwallet1", "0xwallet2", "0xwallet3"]
    assert report.top10_pct == pytest.approx(34.86, abs=0.01)
    # The contract-held supply is kept, not silently discarded.
    assert report.contract_held_pct == pytest.approx(49.1, abs=0.01)


@pytest.mark.asyncio
async def test_refuses_to_publish_a_ratio_on_a_broken_denominator(monkeypatch):
    # Balances exceed the reported supply: the supply figure is wrong.
    items = [_item("0xwallet1", 80_000), _item("0xwallet2", 40_000)]
    monkeypatch.setattr(evm_source, "_get_json", lambda *a, **k: _async({"items": items}))
    report = _report(100_000)

    await evm_source._enrich_holders(report, "https://base.blockscout.com")

    assert report.top10_pct is None, "an impossible ratio must read as unknown, not as a number"
    assert "evm_supply_inconsistent" in report.notes


@pytest.mark.asyncio
async def test_unknown_supply_reads_as_unknown(monkeypatch):
    monkeypatch.setattr(
        evm_source, "_get_json", lambda *a, **k: _async({"items": [_item("0xwallet1", 5)]})
    )
    report = _report(None)

    await evm_source._enrich_holders(report, "https://base.blockscout.com")

    assert report.top10_pct is None
    assert "evm_supply_unknown" in report.notes


@pytest.mark.asyncio
async def test_unavailable_holders_endpoint_is_noted_not_guessed(monkeypatch):
    monkeypatch.setattr(evm_source, "_get_json", lambda *a, **k: _async(None))
    report = _report(100_000)

    await evm_source._enrich_holders(report, "https://base.blockscout.com")

    assert report.top10_pct is None
    assert "evm_holders_unavailable" in report.notes


@pytest.mark.asyncio
async def test_malformed_rows_are_skipped_not_fatal(monkeypatch):
    items = [
        {"address": None, "value": "10"},
        {"address": {"hash": "0xwallet1"}, "value": "not-a-number"},
        _item("0xwallet2", 1_000),
    ]
    monkeypatch.setattr(evm_source, "_get_json", lambda *a, **k: _async({"items": items}))
    report = _report(100_000)

    await evm_source._enrich_holders(report, "https://base.blockscout.com")

    assert [h.address for h in report.top_holders] == ["0xwallet2"]


async def _async(value):
    return value
