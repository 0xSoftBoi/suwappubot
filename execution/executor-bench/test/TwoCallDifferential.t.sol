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

    event GasComparison(uint256 baselineGas, uint256 specializedGas, uint256 savedGas);

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
            address(venueA), 0, data0, address(venueB), 0, data1, address(token), 1_000_000e6
        );
        require(baselineBalance == specializedBalance, "final balance mismatch");
    }

    function testVenueFailureSemanticsMatch() public {
        bytes memory data0 = abi.encodeCall(DifferentialVenue.noop, (hex"01"));
        bytes memory data1 = abi.encodeCall(DifferentialVenue.revertAlways, ());

        (bool baselineOk,) = address(this)
            .call(abi.encodeCall(this.runBaselineExternal, (data0, data1, 1_000_000e6)));
        (bool specializedOk,) = address(specialized)
            .call(
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

        (bool baselineOk,) =
            address(this).call(abi.encodeCall(this.runBaselineExternal, (data0, data1, impossible)));
        (bool specializedOk,) = address(specialized)
            .call(
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

    /// @dev Measures only the encoded external-call execution path. Both payloads are built
    ///      before gas measurement so ABI construction in the harness cannot bias admission.
    function testGasAdmissionTwoCallShape() public {
        bytes memory data0 = abi.encodeCall(DifferentialVenue.noop, (hex"01020304"));
        bytes memory data1 = abi.encodeCall(DifferentialVenue.noop, (hex"05060708090a"));
        uint256 minimum = 1_000_000e6;

        BaselineExecutor.Call[] memory calls = new BaselineExecutor.Call[](2);
        calls[0] = BaselineExecutor.Call({target: address(venueA), value: 0, data: data0});
        calls[1] = BaselineExecutor.Call({target: address(venueB), value: 0, data: data1});
        bytes memory baselinePayload = abi.encodeCall(
            BaselineExecutor.execute,
            (calls, BaselineExecutor.BalanceCheck({token: address(token), minimum: minimum}))
        );
        bytes memory specializedPayload = abi.encodeCall(
            TwoCallExecutor.executeTwo,
            (address(venueA), 0, data0, address(venueB), 0, data1, address(token), minimum)
        );

        uint256 beforeBaseline = gasleft();
        (bool baselineOk,) = address(baseline).call(baselinePayload);
        uint256 baselineGas = beforeBaseline - gasleft();
        require(baselineOk, "baseline benchmark failed");

        uint256 beforeSpecialized = gasleft();
        (bool specializedOk,) = address(specialized).call(specializedPayload);
        uint256 specializedGas = beforeSpecialized - gasleft();
        require(specializedOk, "specialized benchmark failed");

        require(specializedGas < baselineGas, "specialization has no gas advantage");
        uint256 savedGas = baselineGas - specializedGas;
        // A production specialization must save materially more than measurement noise.
        require(savedGas >= 500, "specialization gas win too small");
        emit GasComparison(baselineGas, specializedGas, savedGas);
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
            calls, BaselineExecutor.BalanceCheck({token: address(token), minimum: minimum})
        );
    }
}
