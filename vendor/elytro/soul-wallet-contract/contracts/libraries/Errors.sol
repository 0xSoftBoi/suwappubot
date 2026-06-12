// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

library Errors {
    error ADDRESS_ALREADY_EXISTS();
    error ADDRESS_NOT_EXISTS();
    error DATA_ALREADY_EXISTS();
    error DATA_NOT_EXISTS();
    error CALLER_MUST_BE_SELF_OR_MODULE();
    error CALLER_MUST_BE_MODULE();
    error HASH_ALREADY_APPROVED();
    error HASH_ALREADY_REJECTED();
    error INVALID_ADDRESS();
    error INVALID_SELECTOR();
    error INVALID_SIGNTYPE();
    error MODULE_SELECTORS_EMPTY();
    error MODULE_EXECUTE_FROM_MODULE_RECURSIVE();
    error SELECTOR_ALREADY_EXISTS();
    error SELECTOR_NOT_EXISTS();
    error INVALID_LOGIC_ADDRESS();
    error SAME_LOGIC_ADDRESS();
    error UPGRADE_FAILED();
    error NOT_IMPLEMENTED();
    error INVALID_SIGNATURE();
    error INVALID_TIME_RANGE();
    error UNAUTHORIZED();
    error INVALID_DATA();
    error GUARDIAN_SIGNATURE_INVALID();
}
