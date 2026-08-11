// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";

import {TeeAttestorGate} from "../src/TeeAttestorGate.sol";
import {IFlareTeeManager} from "../src/interfaces/IFlareTeeManager.sol";

/// @dev Answers with a status, like a manager that knows the address.
contract StatusTeeManager is IFlareTeeManager {
    mapping(address => uint8) public status;

    function setStatus(address teeId, uint8 s) external {
        status[teeId] = s;
    }

    function getTeeMachineStatus(address teeId) external view returns (uint8) {
        return status[teeId];
    }

    function getTeeMachine(address) external pure returns (address, address, string memory) {
        return (address(0), address(0), "");
    }
}

/// @dev Reverts with a typed error, which is what the live Coston2 manager does
///      for an address it has never seen. Mirrors the behaviour pinned in
///      TeeAttestorGateFork.t.sol so the fail-closed path is covered offline too.
contract RevertingTeeManager is IFlareTeeManager {
    error UnregisteredMachine();

    function getTeeMachineStatus(address) external pure returns (uint8) {
        revert UnregisteredMachine();
    }

    function getTeeMachine(address) external pure returns (address, address, string memory) {
        revert UnregisteredMachine();
    }
}

contract TeeAttestorGateTest is Test {
    StatusTeeManager internal manager;
    TeeAttestorGate internal gate;

    address internal machine = makeAddr("machine");

    function setUp() public {
        manager = new StatusTeeManager();
        gate = new TeeAttestorGate(address(manager));
    }

    function test_productionIsAttested() public {
        manager.setStatus(machine, 2);
        assertTrue(gate.isAttested(machine));
    }

    /// @dev The distinction the whole gate exists to make. A machine that has
    ///      registered but is not yet serving must authorise nothing.
    function test_initializedIsNotAttested() public {
        manager.setStatus(machine, 1);
        assertFalse(gate.isAttested(machine));
    }

    function test_unknownIsNotAttested() public {
        assertFalse(gate.isAttested(makeAddr("stranger")));
    }

    /// @notice A manager that reverts means "not attested", never a bubbled revert.
    ///
    /// @dev Fails closed, and deliberately so: every failure mode of the call --
    ///      unregistered address, wrong manager, manager paused -- blocks execution
    ///      rather than permitting it. This is the offline twin of the fork test,
    ///      and it is what makes SignerNotAttested the error users actually see.
    function test_revertingManagerMeansNotAttested() public {
        TeeAttestorGate strictGate = new TeeAttestorGate(address(new RevertingTeeManager()));
        assertFalse(strictGate.isAttested(machine));
    }

    function test_revert_zeroManager() public {
        vm.expectRevert(TeeAttestorGate.ManagerNotSet.selector);
        new TeeAttestorGate(address(0));
    }
}
