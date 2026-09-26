//! PyO3 bindings for the desktop build.  Behind the `python` feature so the
//! same wrapper compiles to wasm with no Python in it.
//!
//! Every address, slot and value crosses as a hex string.  JSON-RPC already
//! speaks that, a `U256` has no Python equivalent that survives a round trip,
//! and the cost is microseconds against a call that takes hundreds.  Keeping
//! the spelling identical here and in the wasm shim is what lets one Python
//! module drive either.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict};

use crate::{Address, CallOut, Evm as Core, B256, U256};

fn address(text: &str) -> PyResult<Address> {
    crate::parse_address(text).map_err(PyValueError::new_err)
}

fn word(text: &str) -> PyResult<U256> {
    crate::parse_word(text).map_err(PyValueError::new_err)
}

fn hash(text: &str) -> PyResult<B256> {
    crate::parse_hash(text).map_err(PyValueError::new_err)
}

#[pyclass(name = "Evm", unsendable)]
pub struct PyEvm {
    inner: Core,
}

#[pymethods]
impl PyEvm {
    #[new]
    #[pyo3(signature = (spec="Osaka", chain_id=1))]
    fn new(spec: &str, chain_id: u64) -> PyResult<Self> {
        Core::new(spec, chain_id)
            .map(|inner| Self { inner })
            .map_err(PyValueError::new_err)
    }

    #[pyo3(signature = (number, timestamp, basefee=0, gas_limit=30_000_000,
                        coinbase="0x0000000000000000000000000000000000000000",
                        prevrandao="0x0000000000000000000000000000000000000000000000000000000000000000",
                        excess_blob_gas=None))]
    #[allow(clippy::too_many_arguments)]
    fn set_block(
        &mut self,
        number: u64,
        timestamp: u64,
        basefee: u64,
        gas_limit: u64,
        coinbase: &str,
        prevrandao: &str,
        excess_blob_gas: Option<u64>,
    ) -> PyResult<()> {
        self.inner.set_block(
            number,
            timestamp,
            basefee,
            gas_limit,
            address(coinbase)?,
            hash(prevrandao)?,
            excess_blob_gas,
        );
        Ok(())
    }

    #[pyo3(signature = (address_, nonce=1, balance="0x0", code=None))]
    fn insert_account(
        &mut self,
        address_: &str,
        nonce: u64,
        balance: &str,
        code: Option<&[u8]>,
    ) -> PyResult<()> {
        self.inner
            .insert_account(address(address_)?, nonce, word(balance)?, code);
        Ok(())
    }

    fn set_balance(&mut self, address_: &str, balance: &str) -> PyResult<()> {
        self.inner.set_balance(address(address_)?, word(balance)?);
        Ok(())
    }

    fn insert_storage(&mut self, address_: &str, slot: &str, value: &str) -> PyResult<()> {
        self.inner
            .insert_storage(address(address_)?, word(slot)?, word(value)?);
        Ok(())
    }

    /// `[(address, slot, value), ...]` in one crossing.  The sweep inserts
    /// thousands of these at a time and the per-call overhead dominated.
    fn insert_storage_many(&mut self, entries: Vec<(String, String, String)>) -> PyResult<()> {
        for (who, slot, value) in entries {
            self.inner
                .insert_storage(address(&who)?, word(&slot)?, word(&value)?);
        }
        Ok(())
    }

    fn insert_block_hash(&mut self, number: u64, hash_: &str) -> PyResult<()> {
        self.inner.insert_block_hash(number, hash(hash_)?);
        Ok(())
    }

    fn has_account(&self, address_: &str) -> PyResult<bool> {
        Ok(self.inner.has_account(&address(address_)?))
    }

    /// What this holds for a slot, as hex, without counting it as a miss.
    fn storage_at(&self, address_: &str, slot: &str) -> PyResult<Option<String>> {
        Ok(self
            .inner
            .storage_at(&address(address_)?, word(slot)?)
            .map(|v| format!("{v:#x}")))
    }

    fn code_size(&self, address_: &str) -> PyResult<Option<usize>> {
        Ok(self.inner.code_size(&address(address_)?))
    }

    fn known_slots(&self) -> Vec<(String, String)> {
        self.inner
            .known_slots()
            .into_iter()
            .map(|(who, slot)| (format!("{who:?}"), format!("{slot:#x}")))
            .collect()
    }

    #[getter]
    fn slot_count(&self) -> usize {
        self.inner.slot_count()
    }

    #[getter]
    fn account_count(&self) -> usize {
        self.inner.account_count()
    }

    /// `{"accounts": [...], "slots": [(addr, slot), ...], "blocks": [n, ...]}`
    fn take_misses<'py>(&mut self, py: Python<'py>) -> PyResult<Bound<'py, PyDict>> {
        let misses = self.inner.take_misses();
        let out = PyDict::new(py);
        out.set_item(
            "accounts",
            misses
                .accounts
                .iter()
                .map(|a| format!("{a:?}"))
                .collect::<Vec<_>>(),
        )?;
        out.set_item(
            "slots",
            misses
                .slots
                .iter()
                .map(|(a, s)| (format!("{a:?}"), format!("{s:#x}")))
                .collect::<Vec<_>>(),
        )?;
        out.set_item("blocks", misses.blocks.clone())?;
        Ok(out)
    }

    #[pyo3(signature = (caller, to, data, value="0x0", gas_limit=1_000_000_000))]
    fn call<'py>(
        &mut self,
        py: Python<'py>,
        caller: &str,
        to: &str,
        data: &[u8],
        value: &str,
        gas_limit: u64,
    ) -> PyResult<Bound<'py, PyDict>> {
        let out = self.inner.call(
            address(caller)?,
            address(to)?,
            data,
            word(value)?,
            gas_limit,
        );
        call_dict(py, out)
    }

    /// Many calls in one crossing.  A probe batch is hundreds of them and the
    /// FFI cost per call was a measurable share of a warm quote.
    #[pyo3(signature = (caller, calls, gas_limit=1_000_000_000))]
    fn call_many<'py>(
        &mut self,
        py: Python<'py>,
        caller: &str,
        calls: Vec<(String, Vec<u8>)>,
        gas_limit: u64,
    ) -> PyResult<Vec<Bound<'py, PyDict>>> {
        let caller = address(caller)?;
        let mut out = Vec::with_capacity(calls.len());
        for (to, data) in calls {
            let one = self
                .inner
                .call(caller, address(&to)?, &data, U256::ZERO, gas_limit);
            out.push(call_dict(py, one)?);
        }
        Ok(out)
    }
}

fn call_dict(py: Python<'_>, out: CallOut) -> PyResult<Bound<'_, PyDict>> {
    let dict = PyDict::new(py);
    dict.set_item("success", out.success)?;
    dict.set_item("output", PyBytes::new(py, &out.output))?;
    dict.set_item("gas_used", out.gas_used)?;
    dict.set_item("revert_reason", out.revert_reason)?;
    dict.set_item("halt_reason", out.halt_reason)?;
    Ok(dict)
}

#[pymodule]
fn erouter_evm(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyEvm>()?;
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    Ok(())
}
