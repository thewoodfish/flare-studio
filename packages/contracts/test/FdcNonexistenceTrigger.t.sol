// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";

import {FdcNonexistenceTrigger} from "../src/triggers/FdcNonexistenceTrigger.sol";
import {IFdcVerification} from "../src/interfaces/IFdcVerification.sol";
import {IReferencedPaymentNonexistence as IRPN} from
    "../src/interfaces/IReferencedPaymentNonexistence.sol";
import {ITrigger} from "../src/interfaces/ITrigger.sol";

/// @dev Stands in for Flare's FdcVerification. Every test that matters here is
///      about what we check *after* Flare says the proof is genuine, so the
///      interesting cases are the ones where this returns true and we reject
///      anyway.
contract MockFdcVerification is IFdcVerification {
    bool public result = true;

    function setResult(bool r) external {
        result = r;
    }

    function verifyReferencedPaymentNonexistence(IRPN.Proof calldata)
        external
        view
        returns (bool)
    {
        return result;
    }

    function fdcProtocolId() external pure returns (uint8) {
        return 200;
    }
}

contract FdcNonexistenceTriggerTest is Test {
    FdcNonexistenceTrigger internal trigger;
    MockFdcVerification internal verifier;

    address internal policy = makeAddr("policy");
    address internal owner = makeAddr("owner");

    bytes32 internal constant SOURCE_ID = bytes32("testXRP");
    bytes32 internal constant DESTINATION = keccak256("rOwnerXrplAddress");
    uint256 internal constant MINIMUM = 100_000; // 0.1 XRP in drops
    uint64 internal constant INTERVAL = 30 days;

    uint64 internal start;
    bytes32 internal policyRef;

    function setUp() public {
        // Somewhere well clear of zero so windows can be built either side.
        vm.warp(365 days);

        verifier = new MockFdcVerification();
        trigger = new FdcNonexistenceTrigger(address(verifier));

        start = uint64(block.timestamp);
        policyRef = trigger.policyReference(policy);

        trigger.configure(
            policy,
            FdcNonexistenceTrigger.Config({
                owner: owner,
                sourceId: SOURCE_ID,
                destinationAddressHash: DESTINATION,
                paymentReference: policyRef,
                minimumAmount: MINIMUM,
                interval: INTERVAL,
                start: start
            })
        );
    }

    // --- helpers -------------------------------------------------------------

    /// @dev A proof for the first deadline, valid in every respect.
    function _validProof() internal view returns (IRPN.Proof memory p) {
        uint64 deadline = start + INTERVAL;

        p.merkleProof = new bytes32[](0);
        p.data = IRPN.Response({
            attestationType: trigger.ATTESTATION_TYPE(),
            sourceId: SOURCE_ID,
            votingRound: 1,
            lowestUsedTimestamp: start,
            requestBody: IRPN.RequestBody({
                minimalBlockNumber: 1,
                deadlineBlockNumber: 100,
                deadlineTimestamp: deadline,
                destinationAddressHash: DESTINATION,
                amount: MINIMUM,
                standardPaymentReference: policyRef,
                checkSourceAddresses: false,
                sourceAddressesRoot: bytes32(0)
            }),
            responseBody: IRPN.ResponseBody({
                minimalBlockTimestamp: start,
                firstOverflowBlockNumber: 101,
                firstOverflowBlockTimestamp: deadline + 1
            })
        });
    }

    function _check(IRPN.Proof memory p) internal view returns (bool) {
        return trigger.check(policy, abi.encode(p));
    }

    /// @dev Move past the first deadline so the window has genuinely closed.
    function _afterFirstDeadline() internal {
        vm.warp(start + INTERVAL + 1);
    }

    // --- happy path ----------------------------------------------------------

    function test_provenAbsencePastTheDeadlineFires() public {
        _afterFirstDeadline();
        assertTrue(_check(_validProof()));
    }

    function test_kindIsStable() public view {
        assertEq(ITrigger(address(trigger)).kind(), "fdc-nonexistence");
    }

    // --- the checks, one at a time -------------------------------------------

    /// @dev Flare rejecting the proof ends it. Everything else is downstream.
    function test_revert_unverifiedProof() public {
        _afterFirstDeadline();
        // Built before expectRevert is armed: _validProof() calls
        // trigger.ATTESTATION_TYPE(), and an armed expectRevert would be
        // consumed by that perfectly successful external call instead.
        IRPN.Proof memory p = _validProof();
        verifier.setResult(false);
        vm.expectRevert(FdcNonexistenceTrigger.ProofNotVerified.selector);
        _check(p);
    }

    /// @dev A Payment proof and a nonexistence proof are different claims that
    ///      decode into compatible-looking shapes.
    function test_revert_wrongAttestationType() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.attestationType = bytes32("Payment");
        vm.expectRevert(
            abi.encodeWithSelector(
                FdcNonexistenceTrigger.WrongAttestationType.selector, bytes32("Payment")
            )
        );
        _check(p);
    }

    function test_revert_wrongSourceChain() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.sourceId = bytes32("testBTC");
        vm.expectRevert(
            abi.encodeWithSelector(FdcNonexistenceTrigger.WrongSourceId.selector, bytes32("testBTC"))
        );
        _check(p);
    }

    /// @notice The check that binds a proof to one policy.
    ///
    /// @dev Without it, any genuine nonexistence proof -- including one an
    ///      attacker obtained about their own unused policyRef -- would arm
    ///      every policy on the trigger. This is the single most important
    ///      assertion in the file.
    function test_revert_proofForAnotherPolicy() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.requestBody.standardPaymentReference =
            trigger.policyReference(makeAddr("someone else's policy"));
        vm.expectRevert(
            abi.encodeWithSelector(
                FdcNonexistenceTrigger.WrongPaymentReference.selector,
                trigger.policyReference(makeAddr("someone else's policy"))
            )
        );
        _check(p);
    }

    function test_revert_wrongDestination() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.requestBody.destinationAddressHash = keccak256("somewhere else");
        vm.expectRevert(
            abi.encodeWithSelector(
                FdcNonexistenceTrigger.WrongDestination.selector, keccak256("somewhere else")
            )
        );
        _check(p);
    }

    /// @dev "No payment of 1000 XRP arrived" must not fire a policy whose
    ///      heartbeat is 0.1 XRP. The owner may well have paid the smaller sum.
    function test_revert_attestedAmountBelowOurThreshold() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.requestBody.amount = MINIMUM - 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                FdcNonexistenceTrigger.AmountTooLow.selector, MINIMUM - 1, MINIMUM
            )
        );
        _check(p);
    }

    /// @notice The subtlest hole in the contract.
    ///
    /// @dev With source-address filtering on, an attacker picks a root the owner
    ///      never pays from. Nonexistence is then trivially true, Flare attests
    ///      it honestly, and the policy fires while the owner has been paying
    ///      all along. A genuine proof of an irrelevant question.
    function test_revert_sourceAddressFilteredProof() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.requestBody.checkSourceAddresses = true;
        p.data.requestBody.sourceAddressesRoot = keccak256("addresses the owner never uses");
        vm.expectRevert(FdcNonexistenceTrigger.SourceAddressFilterNotAllowed.selector);
        _check(p);
    }

    /// @dev A proof can be obtained for a deadline in the future; it must not
    ///      fire until that deadline has actually passed.
    function test_revert_deadlineHasNotPassedYet() public {
        IRPN.Proof memory p = _validProof();
        vm.expectRevert(
            abi.encodeWithSelector(
                FdcNonexistenceTrigger.DeadlineNotReached.selector, start + INTERVAL
            )
        );
        _check(p);
    }

    /// @dev Deadlines are start + n*interval. An arbitrary instant would let a
    ///      caller pick a window that happens to contain no payment -- a quiet
    ///      hour rather than a missed month.
    function test_revert_deadlineOffSchedule() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.requestBody.deadlineTimestamp = start + INTERVAL - 1;
        vm.expectRevert(
            abi.encodeWithSelector(
                FdcNonexistenceTrigger.DeadlineNotOnBoundary.selector, start + INTERVAL - 1
            )
        );
        _check(p);
    }

    /// @dev The window has to cover the whole interval. A proof spanning the
    ///      final minute before the deadline proves almost nothing -- the owner
    ///      may have paid on day one.
    function test_revert_windowTooNarrow() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        p.data.responseBody.minimalBlockTimestamp = start + INTERVAL - 60;
        vm.expectRevert(
            abi.encodeWithSelector(
                FdcNonexistenceTrigger.WindowDoesNotCoverInterval.selector,
                start + INTERVAL - 60,
                start
            )
        );
        _check(p);
    }

    function test_revert_unconfiguredPolicy() public {
        _afterFirstDeadline();
        IRPN.Proof memory p = _validProof();
        vm.expectRevert(FdcNonexistenceTrigger.NotConfigured.selector);
        trigger.check(makeAddr("stranger"), abi.encode(p));
    }

    function test_revert_reconfigure() public {
        vm.expectRevert(FdcNonexistenceTrigger.AlreadyConfigured.selector);
        trigger.configure(
            policy,
            FdcNonexistenceTrigger.Config({
                owner: owner,
                sourceId: SOURCE_ID,
                destinationAddressHash: DESTINATION,
                paymentReference: policyRef,
                minimumAmount: MINIMUM,
                interval: INTERVAL,
                start: start
            })
        );
    }

    // --- schedule ------------------------------------------------------------

    function test_currentDeadlineRollsForward() public {
        assertEq(trigger.currentDeadline(policy), start + INTERVAL);

        vm.warp(start + INTERVAL + 1);
        assertEq(trigger.currentDeadline(policy), start + 2 * INTERVAL);

        vm.warp(start + 5 * INTERVAL - 1);
        assertEq(trigger.currentDeadline(policy), start + 5 * INTERVAL);
    }

    /// @dev A later missed deadline works the same way, so a policy that ran
    ///      healthily for months still fires the first time one is missed.
    function test_laterDeadlineAlsoFires() public {
        uint64 deadline = start + 4 * INTERVAL;
        vm.warp(deadline + 1);

        IRPN.Proof memory p = _validProof();
        p.data.requestBody.deadlineTimestamp = deadline;
        p.data.responseBody.minimalBlockTimestamp = deadline - INTERVAL;

        assertTrue(_check(p));
    }

    /// @dev The policy owner is not the one who submits the proof, and must not
    ///      have to be: arming is permissionless precisely because the owner is
    ///      by definition unavailable when it matters.
    function test_anyoneMaySubmitTheProof() public {
        _afterFirstDeadline();
        vm.prank(makeAddr("a stranger doing the family a favour"));
        assertTrue(_check(_validProof()));
    }
}
