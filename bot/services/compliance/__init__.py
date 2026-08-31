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
from bot.services.compliance.screening_events import record_screening_event

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
    "record_screening_event",
]
