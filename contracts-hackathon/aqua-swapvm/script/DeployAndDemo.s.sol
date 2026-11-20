// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {WorldIdPassportSwapVMRouter} from "../src/WorldIdPassportSwapVMRouter.sol";
import {ISwapVM} from "@1inch/swap-vm/contracts/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "@1inch/swap-vm/contracts/libs/MakerTraits.sol";
import {TakerTraitsLib} from "@1inch/swap-vm/contracts/libs/TakerTraits.sol";
import {WhitelistCoequal} from "@1inch/swap-vm/contracts/instructions/Whitelist.sol";
import {Revert, Salt} from "@1inch/swap-vm/contracts/instructions/Controls.sol";
import {XYCSwap} from "@1inch/swap-vm/contracts/instructions/XYCSwap.sol";
import {WorldIdGatedTaker} from "../src/WorldIdGatedTaker.sol";
import {MockERC20} from "../src/MockERC20.sol";

/// @notice Deploys a custom Aqua app using real SwapVM opcodes (WhitelistCoequal +
/// XYCSwap composed into one program), not the plain contract-call pattern used for
/// the earlier Aqua position in this submission. This is the "define custom
/// instructions" path the 1inch bounty scores higher, without hand-writing a new
/// opcode from scratch (avoided — SwapVM's own bit-packing/VM internals are exactly
/// the kind of thing worth reusing rather than reimplementing on a hackathon clock).
contract DeployAndDemo is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);

        vm.startBroadcast(pk);

        Aqua aqua = new Aqua();
        console.log("Aqua:", address(aqua));

        WorldIdPassportSwapVMRouter swapVM =
            new WorldIdPassportSwapVMRouter(address(aqua), address(0), me, "AgentPassportSwapVM", "1.0.0");
        console.log("WorldIdPassportSwapVMRouter:", address(swapVM));

        WorldIdGatedTaker taker = new WorldIdGatedTaker(aqua, swapVM, me);
        console.log("WorldIdGatedTaker:", address(taker));

        MockERC20 tokenA = new MockERC20("Agent Passport SwapVM Token A", "APSA", 1_000_000 ether);
        MockERC20 tokenB = new MockERC20("Agent Passport SwapVM Token B", "APSB", 1_000_000 ether);
        if (address(tokenA) > address(tokenB)) (tokenA, tokenB) = (tokenB, tokenA);
        console.log("tokenA:", address(tokenA));
        console.log("tokenB:", address(tokenB));

        // ---- Compose the program: only the WorldIdGatedTaker (our identity-verified
        // taker contract, the same one populated from World ID off-chain) may trade
        // against this strategy; anyone else reverts before ever reaching the pricing
        // opcode. ----
        address[] memory allowedTakers = new address[](1);
        allowedTakers[0] = address(taker);

        bytes memory revertOp = Revert.build(bytes4(keccak256("TakerNotWorldIdVerified()")));
        uint16 xycOffset = uint16(WhitelistCoequal.sizeOf(0, allowedTakers) + revertOp.length);
        bytes memory whitelistOp = WhitelistCoequal.build(xycOffset, allowedTakers);
        bytes memory xycOp = XYCSwap.build();
        bytes memory saltOp = Salt.build(uint64(block.timestamp));

        bytes memory program = bytes.concat(whitelistOp, revertOp, xycOp, saltOp);
        console.log("program length:", program.length);

        ISwapVM.Order memory order = MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: me,
                receiver: address(0),
                tokenA: address(tokenA),
                tokenB: address(tokenB),
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                usePermit2: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program
            })
        );

        bytes32 orderHash = swapVM.hash(order);

        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1000 ether;
        amounts[1] = 1000 ether;

        bytes32 strategyHash = aqua.ship(address(swapVM), abi.encode(order), tokens, amounts);
        require(strategyHash == orderHash, "hash mismatch");
        console.log("strategy shipped");

        tokenA.transfer(address(taker), 10 ether);

        bytes memory takerTraitsAndData = TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(taker),
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: false,
                isAToB: true,
                allowPartialFill: false,
                usePermit2: false,
                threshold: "",
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: true,
                hasPreTransferOutCallback: false,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );

        (uint256 amountIn, uint256 amountOut) = taker.swap(order, 1 ether, takerTraitsAndData);
        console.log("swap executed, amountIn:", amountIn, "amountOut:", amountOut);

        vm.stopBroadcast();
    }
}
