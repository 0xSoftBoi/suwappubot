// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Context} from "@1inch/swap-vm/contracts/libs/VM.sol";
import {SwapVM} from "@1inch/swap-vm/contracts/SwapVM.sol";
import {Simulator} from "@1inch/solidity-utils/contracts/mixins/Simulator.sol";
import {AquaOpcodesWithWhitelist} from "./AquaOpcodesWithWhitelist.sol";

/// @title WorldIdPassportSwapVMRouter
/// @notice Same shape as 1inch's own `AquaSwapVMRouter`, with `AquaOpcodesWithWhitelist`
/// swapped in for `AquaOpcodes` so identity-gated strategies (World ID passport, see
/// `WorldIdGatedTaker.sol` and `script/DeployAndDemo.s.sol`) can compose the
/// `WhitelistCoequal` opcode with real Aqua-backed liquidity.
contract WorldIdPassportSwapVMRouter is Simulator, SwapVM, AquaOpcodesWithWhitelist {
    constructor(address aqua, address weth, address owner, string memory name, string memory version)
        SwapVM(aqua, weth, owner, name, version)
    {}

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}
