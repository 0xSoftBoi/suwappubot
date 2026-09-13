"""Compliance screening for EVM transactions (UBS × Nethermind PoC model).

Exposes a single global ``compliance_service`` instance plus the result types
used by callers. See ``compliance_service.py`` for the full rationale.
"""

from bot.services.compliance.compliance_service import (
    AddressComplianceService,
    AddressVerdict,
    ComplianceError,
    ComplianceMode,
    ComplianceResult,
    ScreeningPolicy,
    compliance_service,
)
from bot.services.compliance.flashbots_relay import (
    FlashbotsRelay,
    RelayResult,
    flashbots_relay,
)
from bot.services.compliance.sdn_feed import SdnFeed, run_sdn_feed_loop, sdn_feed
from bot.services.compliance.trm_sanctions import TrmSanctionsClient, trm_sanctions_client

__all__ = [
    "AddressComplianceService",
    "AddressVerdict",
    "ComplianceError",
    "ComplianceMode",
    "ComplianceResult",
    "ScreeningPolicy",
    "compliance_service",
    "FlashbotsRelay",
    "RelayResult",
    "flashbots_relay",
    "SdnFeed",
    "run_sdn_feed_loop",
    "sdn_feed",
    "TrmSanctionsClient",
    "trm_sanctions_client",
]
