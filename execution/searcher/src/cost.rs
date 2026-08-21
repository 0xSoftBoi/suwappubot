use crate::events::Fixed;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ExecutionShape {
    pub gas_units: u64,
    pub calldata_bytes: u32,
    pub external_calls: u16,
    pub token_transfers: u16,
}

/// Quote-denominated coefficients for execution resources.
///
/// The caller calibrates these from current gas/native-asset prices and measured venue
/// overhead. Keeping this layer quote-denominated avoids silently hard-coding ETH/USD.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CostCoefficients {
    pub quote_per_gas_unit: Fixed,
    pub quote_per_calldata_byte: Fixed,
    pub quote_per_external_call: Fixed,
    pub quote_per_token_transfer: Fixed,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RouteEconomics {
    pub gross_pnl_quote: Fixed,
    pub variable_fees_quote: Fixed,
    pub execution_cost_quote: Fixed,
    pub funding_cost_quote: Fixed,
    pub builder_cost_quote: Fixed,
    pub risk_buffer_quote: Fixed,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CostError {
    #[error("execution cost coefficient cannot be negative")]
    NegativeCoefficient,
    #[error("route cost cannot be negative")]
    NegativeRouteCost,
    #[error("fixed-point arithmetic overflow")]
    Overflow,
}

pub fn execution_cost(
    shape: ExecutionShape,
    coefficients: CostCoefficients,
) -> Result<Fixed, CostError> {
    let values = [
        coefficients.quote_per_gas_unit,
        coefficients.quote_per_calldata_byte,
        coefficients.quote_per_external_call,
        coefficients.quote_per_token_transfer,
    ];
    if values.iter().any(|value| *value < 0) {
        return Err(CostError::NegativeCoefficient);
    }

    let gas = checked_scale(coefficients.quote_per_gas_unit, i128::from(shape.gas_units))?;
    let calldata = checked_scale(
        coefficients.quote_per_calldata_byte,
        i128::from(shape.calldata_bytes),
    )?;
    let calls = checked_scale(
        coefficients.quote_per_external_call,
        i128::from(shape.external_calls),
    )?;
    let transfers = checked_scale(
        coefficients.quote_per_token_transfer,
        i128::from(shape.token_transfers),
    )?;

    gas.checked_add(calldata)
        .and_then(|value| value.checked_add(calls))
        .and_then(|value| value.checked_add(transfers))
        .ok_or(CostError::Overflow)
}

impl RouteEconomics {
    pub fn net_pnl_quote(self) -> Result<Fixed, CostError> {
        let costs = [
            self.variable_fees_quote,
            self.execution_cost_quote,
            self.funding_cost_quote,
            self.builder_cost_quote,
            self.risk_buffer_quote,
        ];
        if costs.iter().any(|value| *value < 0) {
            return Err(CostError::NegativeRouteCost);
        }

        costs.into_iter().try_fold(self.gross_pnl_quote, |net, cost| {
            net.checked_sub(cost).ok_or(CostError::Overflow)
        })
    }
}

fn checked_scale(unit_cost: Fixed, units: i128) -> Result<Fixed, CostError> {
    unit_cost.checked_mul(units).ok_or(CostError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FIXED_SCALE;

    #[test]
    fn route_shape_costs_are_visible_to_optimizer() {
        let shape = ExecutionShape {
            gas_units: 100_000,
            calldata_bytes: 100,
            external_calls: 2,
            token_transfers: 3,
        };
        let coefficients = CostCoefficients {
            quote_per_gas_unit: FIXED_SCALE / 100_000,
            quote_per_calldata_byte: FIXED_SCALE / 1_000,
            quote_per_external_call: FIXED_SCALE / 10,
            quote_per_token_transfer: FIXED_SCALE / 20,
        };
        let cost = execution_cost(shape, coefficients).unwrap();
        assert_eq!(cost, 1_450_000_000);
    }

    #[test]
    fn net_pnl_subtracts_all_cost_buckets_once() {
        let p = FIXED_SCALE;
        let economics = RouteEconomics {
            gross_pnl_quote: 100 * p,
            variable_fees_quote: 5 * p,
            execution_cost_quote: 10 * p,
            funding_cost_quote: 2 * p,
            builder_cost_quote: 20 * p,
            risk_buffer_quote: 3 * p,
        };
        assert_eq!(economics.net_pnl_quote().unwrap(), 60 * p);
    }

    #[test]
    fn negative_cost_is_rejected() {
        let economics = RouteEconomics {
            gross_pnl_quote: 1,
            variable_fees_quote: -1,
            ..RouteEconomics::default()
        };
        assert_eq!(economics.net_pnl_quote().unwrap_err(), CostError::NegativeRouteCost);
    }
}
