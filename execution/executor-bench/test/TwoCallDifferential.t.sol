// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {BaselineExecutor} from "../src/BaselineExecutor.sol";
import {TwoCallExecutor} from "../src/TwoCallExecutor.sol";

contract DifferentialBalanceToken {
    mapping(address => uint256) public balanceOf;

    function setBalance(address account, uint256 amount) external {
        balanceOf[account] = amount;
    }
}

contract DifferentialVenue {
    function noop(bytes calldata payload) external pure returns (bytes32) {
        return keccak256(payload);
    }

    function revertAlways() external pure {
        revert("venue failure");
    }
}

contract TwoCallDifferentialTest {
    BaselineExecutor internal baseline;
    TwoCallExecutor internal specialized;
    DifferentialBalanceToken internal token;
    DifferentialVenue internal venueA;
    DifferentialVenue internal venueB;

    event GasComparison(uint256 baselineGas, uint256 specializedGas, int256 delta);

    function setUp() public {
        baseline = new BaselineExecutor();
        specialized = new TwoCallExecutor();
        token = new DifferentialBalanceToken();
        venueA = new DifferentialVenue();
        venueB = new DifferentialVenue();
        token.setBalance(address(baseline), 1_000_000e6);
        token.setBalance(address(specialized), 1_000_000e6);
    }

    function testSuccessSemanticsMatch() public {
        bytes memory data0 = abi.encodeCall(DifferentialVenue.noop, (hex"01020304"));
        bytes memory data1 = abi.encodeCall(DifferentialVenue.noop, (hex"05060708090a"));
        uint256 baselineBalance = _runBaseline(data0, data1, 1_000_000e6);
        uint256 specializedBalance = specialized.executeTwo(
            address(venueA),
            0,
            data0,
            address(venueB),
            0,
            data1,
            address(token),
            1_000_000e6
        );
        require(baselineBalance == specializedBalance, "final balance mismatch");
    }

    function testVenueFailureSemanticsMatch() public {
        bytes memory data0 = abi.encodeCall(DifferentialVenue.noop, (hex"01"));
        bytes memory data1 = abi.encodeCall(DifferentialVenue.revertAlways, ());

        (bool baselineOk,) = address(this).call(
            abi.encodeCall(this.runBaselineExternal, (data0, data1, 1_000_000e6))
        );
        (bool specializedOk,) = address(specialized).call(
            abi.encodeCall(
                TwoCallExecutor.executeTwo,
                (
                    address(venueA),
                    0,
                    data0,
                    address(venueB),
                    0,
                    data1,
                    address(token),
                    1_000_000e6
                )
            )
        );
        require(!baselineOk && !specializedOk, "both must fail closed");
    }

    function testEconomicPostconditionSemanticsMatch() public {
        bytes memory data0 = abi.encodeCall(DifferentialVenue.noop, (hex"01"));
        bytes memory data1 = abi.encodeCall(DifferentialVenue.noop, (hex"02"));
        uint256 impossible = 1_000_001e6;

        (bool baselineOk,) = address(this).call(
            abi.encodeCall(this.runBaselineExternal, (data0, data1, impossible))
        );
        (bool specializedOk,) = address(specialized).call(
            abi.encodeCall(
                TwoCallExecutor.executeTwo,
                (
                    address(venueA),
                    0,
                    data0,
                    address(venueB),
                    0,
                    data1,
                    address(token),
                    impossible
                )
            )
        );
        require(!baselineOk && !specializedOk, "both must enforce final economics");
    }

    function testGasComparisonTwoCallShape() public {
        bytes memory data0 = abi.encodeCall(DifferentialVenue.noop, (hex"01020304"));
        bytes memory data1 = abi.encodeCall(DifferentialVenue.noop, (hex"05060708090a"));

        uint256 beforeBaseline = gasleft();
        _runBaseline(data0, data1, 1_000_000e6);
        uint256 baselineGas = beforeBaseline - gasleft();

        uint256 beforeSpecialized = gasleft();
        specialized.executeTwo(
            address(venueA),
            0,
            data0,
            address(venueB),
            0,
            data1,
            address(token),
            1_000_000e6
        );
        uint256 specializedGas = beforeSpecialized - gasleft();

        emit GasComparison(baselineGas, specializedGas, int256(baselineGas) - int256(specializedGas));
    }

    function runBaselineExternal(bytes calldata data0, bytes calldata data1, uint256 minimum)
        external
        returns (uint256)
    {
        return _runBaseline(data0, data1, minimum);
    }

    function _runBaseline(bytes memory data0, bytes memory data1, uint256 minimum)
        internal
        returns (uint256)
    {
        BaselineExecutor.Call[] memory calls = new BaselineExecutor.Call[](2);
        calls[0] = BaselineExecutor.Call({target: address(venueA), value: 0, data: data0});
        calls[1] = BaselineExecutor.Call({target: address(venueB), value: 0, data: data1});
        return baseline.execute(
            calls,
            BaselineExecutor.BalanceCheck({token: address(token), minimum: minimum})
        );
    }
}
