// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";

import {TimestampTrigger} from "../src/triggers/TimestampTrigger.sol";
import {ITrigger} from "../src/interfaces/ITrigger.sol";

/// @dev The second trigger, tested through the same ITrigger surface as the
///      first. If these tests ever need to know which policy template is in
///      play, the seam has stopped being a seam.
contract TimestampTriggerTest is Test {
    TimestampTrigger internal trigger;

    address internal policy = makeAddr("policy");
    uint64 internal target;

    function setUp() public {
        trigger = new TimestampTrigger();
        target = uint64(block.timestamp + 365 days);
        trigger.configure(policy, target);
    }

    function test_falseBeforeTheDate() public view {
        assertFalse(trigger.check(policy, ""));
    }

    function test_trueAfterTheDate() public {
        vm.warp(target + 1);
        assertTrue(trigger.check(policy, ""));
    }

    /// @dev The boundary is `>`, not `>=`: at exactly the target second the date
    ///      has arrived but not passed. Worth pinning, because an off-by-one here
    ///      is invisible until someone deploys with a date one second away.
    function test_falseAtExactlyTheDate() public {
        vm.warp(target);
        assertFalse(trigger.check(policy, ""));
    }

    function test_revert_checkBeforeConfigured() public {
        vm.expectRevert(TimestampTrigger.NotConfigured.selector);
        trigger.check(makeAddr("unconfigured"), "");
    }

    /// @dev Write-once. A mutable date would let an owner postpone a
    ///      distribution forever, which is the guarantee recipients are relying on.
    function test_revert_reconfigure() public {
        vm.expectRevert(TimestampTrigger.AlreadyConfigured.selector);
        trigger.configure(policy, target + 1 days);
    }

    function test_revert_dateInThePast() public {
        vm.expectRevert(TimestampTrigger.TimestampInPast.selector);
        trigger.configure(makeAddr("other"), uint64(block.timestamp - 1));
    }

    /// @dev The kind string is what the UI and any indexer key off, so it is part
    ///      of the contract's surface rather than a debugging aid.
    function test_kindIsStable() public view {
        assertEq(ITrigger(address(trigger)).kind(), "timestamp");
    }
}
