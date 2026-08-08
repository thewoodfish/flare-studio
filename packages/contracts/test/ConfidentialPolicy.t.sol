// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ConfidentialPolicy} from "../src/ConfidentialPolicy.sol";
import {PolicyFactory} from "../src/PolicyFactory.sol";
import {TeeAttestorGate} from "../src/TeeAttestorGate.sol";
import {ManualHeartbeatTrigger} from "../src/triggers/ManualHeartbeatTrigger.sol";
import {IFlareTeeManager} from "../src/interfaces/IFlareTeeManager.sol";

/// @dev Stands in for Flare's FlareTeeManager in unit tests so we can drive
///      machine status directly. The plan also calls for a fork test against the
///      live manager on Coston2 -- this mock proves our logic, that proves our
///      integration. Neither substitutes for the other.
contract MockTeeManager is IFlareTeeManager {
    mapping(address => uint8) public status;

    function setStatus(address teeId, uint8 s) external {
        status[teeId] = s;
    }

    function getTeeMachineStatus(address teeId) external view returns (uint8) {
        return status[teeId];
    }

    function getTeeMachine(address)
        external
        pure
        returns (address, address, string memory)
    {
        return (address(0), address(0), "");
    }
}

/// @dev FXRP is a real FAsset on Coston2 and is resolved from the registry at
///      deploy time. This local ERC20 exists only so unit tests do not need a fork.
contract TestToken is ERC20 {
    constructor() ERC20("Test FAsset", "tFA") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract ConfidentialPolicyTest is Test {
    ConfidentialPolicy internal implementation;
    PolicyFactory internal factory;
    TeeAttestorGate internal gate;
    ManualHeartbeatTrigger internal trigger;
    MockTeeManager internal teeManager;
    TestToken internal asset;

    address internal owner = makeAddr("owner");
    address internal recipientA = makeAddr("recipientA");
    address internal recipientB = makeAddr("recipientB");

    uint256 internal teePk;
    address internal teeId;
    uint256 internal impostorPk;

    uint64 internal constant INTERVAL = 30 days;
    uint256 internal constant FUNDING = 1_000e18;
    bytes32 internal constant SALT = keccak256("policy-salt");

    ConfidentialPolicy internal policy;
    ConfidentialPolicy.Share[] internal shares;

    function setUp() public {
        (teeId, teePk) = makeAddrAndKey("teeMachine");
        (, impostorPk) = makeAddrAndKey("impostor");

        teeManager = new MockTeeManager();
        teeManager.setStatus(teeId, 2); // PRODUCTION

        gate = new TeeAttestorGate(address(teeManager));
        trigger = new ManualHeartbeatTrigger();
        implementation = new ConfidentialPolicy();
        factory = new PolicyFactory(address(implementation));
        asset = new TestToken();

        shares.push(ConfidentialPolicy.Share({recipient: recipientA, shareBps: 6000}));
        shares.push(ConfidentialPolicy.Share({recipient: recipientB, shareBps: 4000}));

        policy = _deployPolicy(_commitmentFor(shares, SALT), true);

        asset.mint(owner, FUNDING);
        vm.startPrank(owner);
        asset.approve(address(policy), FUNDING);
        policy.deposit(FUNDING);
        vm.stopPrank();
    }

    // --- helpers -------------------------------------------------------------

    function _deployPolicy(bytes32 commitment, bool demoMode)
        internal
        returns (ConfidentialPolicy p)
    {
        vm.prank(owner);
        address addr = factory.deploy(
            address(asset), commitment, address(gate), address(trigger), new address[](0)
        );
        p = ConfidentialPolicy(addr);
        trigger.configure(addr, owner, INTERVAL, demoMode);
    }

    function _commitmentFor(ConfidentialPolicy.Share[] memory s, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(s, salt));
    }

    function _sign(ConfidentialPolicy p, uint256 pk) internal view returns (bytes memory) {
        bytes32 sharesHash;
        {
            bytes32[] memory hashes = new bytes32[](shares.length);
            bytes32 typehash = keccak256("Share(address recipient,uint16 shareBps)");
            for (uint256 i = 0; i < shares.length; i++) {
                hashes[i] =
                    keccak256(abi.encode(typehash, shares[i].recipient, shares[i].shareBps));
            }
            sharesHash = keccak256(abi.encodePacked(hashes));
        }

        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Execution(bytes32 commitment,bytes32 sharesHash,uint256 triggeredAt)"
                ),
                p.commitment(),
                sharesHash,
                p.triggeredAt()
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked(bytes1(0x19), bytes1(0x01), _domainSeparator(p), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _domainSeparator(ConfidentialPolicy p) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("FlareStudioPolicy")),
                keccak256(bytes("1")),
                block.chainid,
                address(p)
            )
        );
    }

    function _arm(ConfidentialPolicy p) internal {
        vm.prank(owner);
        trigger.simulateInactivity(address(p));
        p.arm("");
    }

    // --- happy path ----------------------------------------------------------

    function test_fullLifecycle_distributesToRecipients() public {
        _arm(policy);
        policy.execute(shares, SALT, _sign(policy, teePk));

        assertEq(asset.balanceOf(recipientA), 600e18);
        assertEq(asset.balanceOf(recipientB), 400e18);
        assertEq(asset.balanceOf(address(policy)), 0);
        assertEq(uint8(policy.status()), uint8(ConfidentialPolicy.Status.Executed));
    }

    function test_heartbeatPushesDeadlineOut() public {
        uint64 before = trigger.deadlineOf(address(policy));
        vm.warp(block.timestamp + 10 days);
        vm.prank(owner);
        trigger.heartbeat(address(policy));
        assertGt(trigger.deadlineOf(address(policy)), before);
        assertFalse(trigger.check(address(policy), ""));
    }

    function test_armingIsPermissionless() public {
        vm.prank(owner);
        trigger.simulateInactivity(address(policy));
        vm.prank(makeAddr("anyStranger"));
        policy.arm("");
        assertEq(uint8(policy.status()), uint8(ConfidentialPolicy.Status.Triggered));
    }

    // --- the security claims -------------------------------------------------

    /// @dev Bounty 2's claim in one test: a signature from a key that is not an
    ///      attested PRODUCTION machine is worthless, even if everything else
    ///      about the request is valid.
    function test_revert_signerNotAttested() public {
        _arm(policy);
        // Sign before arming expectRevert: _sign makes view calls on the policy,
        // and expectRevert applies to the very next call of any kind.
        bytes memory sig = _sign(policy, impostorPk);
        vm.expectRevert();
        policy.execute(shares, SALT, sig);
    }

    /// @dev INITIALIZED is not PRODUCTION. A machine that registered but is not
    ///      yet serving data providers must not be able to authorise anything.
    function test_revert_machineMerelyInitialized() public {
        teeManager.setStatus(teeId, 1);
        _arm(policy);
        bytes memory sig = _sign(policy, teePk);
        vm.expectRevert();
        policy.execute(shares, SALT, sig);
    }

    /// @dev The commitment is what stops even an attested machine from
    ///      substituting a different payout. Attestation alone is not enough.
    function test_revert_tamperedDistribution() public {
        _arm(policy);
        // The attested machine itself tries to redirect the payout: it signs the
        // tampered set honestly, so only the commitment stands between the
        // recipients and an attacker.
        shares[0].recipient = makeAddr("attacker");
        bytes memory sig = _sign(policy, teePk);
        vm.expectRevert(ConfidentialPolicy.CommitmentMismatch.selector);
        policy.execute(shares, SALT, sig);
    }

    function test_revert_wrongSalt() public {
        _arm(policy);
        bytes memory sig = _sign(policy, teePk);
        vm.expectRevert(ConfidentialPolicy.CommitmentMismatch.selector);
        policy.execute(shares, keccak256("wrong"), sig);
    }

    function test_revert_executeBeforeArmed() public {
        bytes memory sig = _sign(policy, teePk);
        vm.expectRevert();
        policy.execute(shares, SALT, sig);
    }

    function test_revert_replayAfterExecution() public {
        _arm(policy);
        bytes memory sig = _sign(policy, teePk);
        policy.execute(shares, SALT, sig);
        vm.expectRevert();
        policy.execute(shares, SALT, sig);
    }

    /// @dev Each policy is its own EIP-712 domain, so a valid signature for one
    ///      policy must not authorise another -- even with identical contents and
    ///      the same attested signer.
    function test_revert_signatureFromAnotherPolicy() public {
        ConfidentialPolicy other = _deployPolicy(_commitmentFor(shares, SALT), true);
        asset.mint(address(other), FUNDING);

        _arm(policy);
        _arm(other);

        bytes memory sigForOther = _sign(other, teePk);
        vm.expectRevert();
        policy.execute(shares, SALT, sigForOther);
    }

    function test_revert_armBeforeDeadline() public {
        ConfidentialPolicy fresh = _deployPolicy(_commitmentFor(shares, SALT), true);
        vm.expectRevert(ConfidentialPolicy.TriggerNotMet.selector);
        fresh.arm("");
    }

    /// @dev simulateInactivity is demo scaffolding living in a production contract.
    ///      The flag is what keeps it inert for real policies, so prove it.
    function test_revert_simulateInactivityWhenDemoModeOff() public {
        ConfidentialPolicy real = _deployPolicy(_commitmentFor(shares, SALT), false);
        vm.prank(owner);
        vm.expectRevert(ManualHeartbeatTrigger.DemoModeDisabled.selector);
        trigger.simulateInactivity(address(real));
    }

    function test_revert_simulateInactivityByNonOwner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ManualHeartbeatTrigger.NotPolicyOwner.selector);
        trigger.simulateInactivity(address(policy));
    }

    function test_revert_withdrawByNonOwner() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ConfidentialPolicy.NotOwner.selector);
        policy.withdraw(1e18);
    }

    function test_cancelReturnsFundsToOwner() public {
        vm.prank(owner);
        policy.cancel();
        assertEq(asset.balanceOf(owner), FUNDING);
        assertEq(uint8(policy.status()), uint8(ConfidentialPolicy.Status.Cancelled));
    }

    /// @dev The whole point of committing to shares rather than amounts: a
    ///      compromised enclave holding a valid signing key still cannot move
    ///      funds anywhere except to the recipients, in the proportions, fixed at
    ///      deploy time. It signs; it does not decide.
    function test_revert_attestedMachineCannotAlterProportions() public {
        _arm(policy);
        shares[0].shareBps = 9999;
        shares[1].shareBps = 1;
        bytes memory sig = _sign(policy, teePk);
        vm.expectRevert(ConfidentialPolicy.CommitmentMismatch.selector);
        policy.execute(shares, SALT, sig);
    }

    /// @dev Integer division must not strand dust: once Executed the policy can
    ///      never fire again, so anything left behind is lost forever.
    function test_indivisibleBalanceLeavesNoDust() public {
        ConfidentialPolicy p = _deployPolicy(_commitmentFor(shares, SALT), true);
        uint256 awkward = 1_000_000_007; // prime, does not divide by 6000/4000
        asset.mint(address(p), awkward);

        _arm(p);
        p.execute(shares, SALT, _sign(p, teePk));

        assertEq(asset.balanceOf(address(p)), 0, "dust stranded in policy");
        assertEq(
            asset.balanceOf(recipientA) + asset.balanceOf(recipientB),
            awkward + FUNDING * 0,
            "total distributed must equal balance"
        );
    }

    // --- genericity ----------------------------------------------------------

    /// @dev The engine must not know what template it is serving. If this ever
    ///      needs changing to add a template, the abstraction has leaked.
    function test_policyHoldsNoTriggerSpecificState() public view {
        assertEq(policy.trigger().kind(), "manual-heartbeat");
        assertEq(policy.conditionCount(), 0);
    }
}
