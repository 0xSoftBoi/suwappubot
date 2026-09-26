// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {BaselineExecutor} from "../src/BaselineExecutor.sol";

contract MockBalanceToken {
    mapping(address => uint256) public balanceOf;

    function setBalance(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}

contract MockVenue {
    function noop(bytes calldata payload) external pure returns (bytes32) {
        return keccak256(payload);
    }

    function revertAlways() external pure {
        revert("venue failure");
    }
}

contract ExecutorGasTest {
    BaselineExecutor internal executor;
    MockBalanceToken internal token;
    MockVenue internal venueA;
    MockVenue internal venueB;

    event GasBaseline(
        string scenario, uint256 gasUsed, uint256 calldataBytes, uint256 externalCalls
    );

    function setUp() public {
        executor = new BaselineExecutor();
        token = new MockBalanceToken();
        venueA = new MockVenue();
        venueB = new MockVenue();
        token.setBalance(address(executor), 1_000_000e6);
    }

    function testGasBaselineOneCall() public {
        BaselineExecutor.Call[] memory calls = new BaselineExecutor.Call[](1);
        calls[0] = BaselineExecutor.Call({
            target: address(venueA), value: 0, data: abi.encodeCall(MockVenue.noop, (hex"01020304"))
        });

        uint256 beforeGas = gasleft();
        uint256 balance = executor.execute(
            calls, BaselineExecutor.BalanceCheck({token: address(token), minimum: 1_000_000e6})
        );
        uint256 used = beforeGas - gasleft();

        require(balance == 1_000_000e6, "balance postcondition");
        emit GasBaseline("one-call", used, calls[0].data.length, 1);
    }

    function testGasBaselineTwoCalls() public {
        BaselineExecutor.Call[] memory calls = new BaselineExecutor.Call[](2);
        calls[0] = BaselineExecutor.Call({
            target: address(venueA), value: 0, data: abi.encodeCall(MockVenue.noop, (hex"01020304"))
        });
        calls[1] = BaselineExecutor.Call({
            target: address(venueB),
            value: 0,
            data: abi.encodeCall(MockVenue.noop, (hex"05060708090a"))
        });

        uint256 beforeGas = gasleft();
        uint256 balance = executor.execute(
            calls, BaselineExecutor.BalanceCheck({token: address(token), minimum: 1_000_000e6})
        );
        uint256 used = beforeGas - gasleft();

        require(balance == 1_000_000e6, "balance postcondition");
        emit GasBaseline("two-call", used, calls[0].data.length + calls[1].data.length, 2);
    }

    function testRevertsWhenFinalEconomicPostconditionFails() public {
        BaselineExecutor.Call[] memory calls = new BaselineExecutor.Call[](0);
        (bool ok,) = address(executor)
            .call(
                abi.encodeCall(
                    BaselineExecutor.execute,
                    (
                        calls,
                        BaselineExecutor.BalanceCheck({token: address(token), minimum: 1_000_001e6})
                    )
                )
            );
        require(!ok, "must fail closed");
    }

    function testRevertsWhenVenueCallFails() public {
        BaselineExecutor.Call[] memory calls = new BaselineExecutor.Call[](1);
        calls[0] = BaselineExecutor.Call({
            target: address(venueA), value: 0, data: abi.encodeCall(MockVenue.revertAlways, ())
        });

        (bool ok,) = address(executor)
            .call(
                abi.encodeCall(
                    BaselineExecutor.execute,
                    (
                        calls,
                        BaselineExecutor.BalanceCheck({token: address(token), minimum: 1_000_000e6})
                    )
                )
            );
        require(!ok, "failed venue call must revert route");
    }
}
