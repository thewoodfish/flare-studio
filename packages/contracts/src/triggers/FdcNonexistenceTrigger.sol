// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ITrigger} from "../interfaces/ITrigger.sol";
import {IFdcVerification} from "../interfaces/IFdcVerification.sol";
import {IReferencedPaymentNonexistence} from "../interfaces/IReferencedPaymentNonexistence.sol";

/// @notice Proof-of-life by external-chain payment, with the absence attested.
///
/// ManualHeartbeatTrigger has the owner *assert* they are alive by calling a
/// function. This has the protocol *observe* it: the owner sends a small payment
/// on the source chain carrying this policy's own reference, and FDC attests
/// that no such payment arrived before a deadline. The owner proves presence;
/// the protocol proves absence.
///
/// That asymmetry is the point. A contract cannot normally know that nothing
/// happened -- only what did. `ReferencedPaymentNonexistence` is what turns a
/// dead-man's switch from a timer someone has to trust into a cryptographic
/// statement.
///
/// Note what this contract owns and ConfidentialPolicy does not: the payment
/// reference, the destination, the amount, the interval. The policy still holds
/// none of it, and still does not know why it fires. This is the third ITrigger
/// through the same seam, and it required no change to the engine.
contract FdcNonexistenceTrigger is ITrigger {
    /// @dev bytes32("ReferencedPaymentNonexistence"), left-aligned, as FDC encodes it.
    bytes32 public constant ATTESTATION_TYPE =
        0x5265666572656e6365645061796d656e744e6f6e6578697374656e6365000000;

    struct Config {
        address owner;
        /// @dev FDC source id, e.g. bytes32("testXRP"). Configuration, not a
        ///      constant: the same trigger serves BTC and DOGE unchanged.
        bytes32 sourceId;
        /// @dev The destination the owner pays to, hashed as FDC hashes it.
        bytes32 destinationAddressHash;
        /// @dev Derived from the policy address, so a proof for one policy is
        ///      worthless against another. See chain-payments.ts for the mirror.
        bytes32 paymentReference;
        uint256 minimumAmount;
        uint64 interval;
        /// @dev The clock's origin. Deadlines are start + n*interval.
        uint64 start;
    }

    IFdcVerification public immutable fdcVerification;

    mapping(address policy => Config) public configs;

    event Configured(address indexed policy, bytes32 paymentReference, uint64 interval);

    error AlreadyConfigured();
    error NotConfigured();
    error IntervalTooShort();
    error VerifierNotSet();

    /// @dev Reasons a submitted proof does not entitle this policy to arm. Typed
    ///      individually because "the proof was rejected" is useless when the
    ///      owner is, by construction, unavailable to debug it.
    error ProofNotVerified();
    error WrongAttestationType(bytes32 got);
    error WrongSourceId(bytes32 got);
    error WrongPaymentReference(bytes32 got);
    error WrongDestination(bytes32 got);
    error AmountTooLow(uint256 got, uint256 required);
    error SourceAddressFilterNotAllowed();
    error DeadlineNotReached(uint64 deadline);
    error DeadlineNotOnBoundary(uint64 deadline);
    error WindowDoesNotCoverInterval(uint64 minimalBlockTimestamp, uint64 required);

    constructor(address fdcVerification_) {
        if (fdcVerification_ == address(0)) revert VerifierNotSet();
        fdcVerification = IFdcVerification(fdcVerification_);
    }

    /// @dev Called once per policy, by whoever is setting the policy up.
    function configure(address policy, Config calldata config) external {
        if (configs[policy].owner != address(0)) revert AlreadyConfigured();
        if (config.interval == 0) revert IntervalTooShort();
        configs[policy] = config;
        emit Configured(policy, config.paymentReference, config.interval);
    }

    /// @inheritdoc ITrigger
    ///
    /// @param proof ABI-encoded IReferencedPaymentNonexistence.Proof.
    ///
    /// @dev Every check below is load-bearing. Dropping any one of them lets a
    ///      proof that is perfectly valid *in itself* fire a policy it has
    ///      nothing to do with -- FDC attests what the request asked about, so
    ///      binding the request to this policy is entirely our job.
    ///
    ///      forge-lint: block.timestamp is compared against deadlines that are
    ///      months apart. A validator shifting it by seconds gains nothing.
    // forge-lint: disable-next-line(block-timestamp)
    function check(address policy, bytes calldata proof) external view returns (bool) {
        Config storage cfg = configs[policy];
        if (cfg.owner == address(0)) revert NotConfigured();

        IReferencedPaymentNonexistence.Proof memory p =
            abi.decode(proof, (IReferencedPaymentNonexistence.Proof));

        // 1. Flare says this attestation is in a finalised voting round. Without
        //    this the rest is a struct someone made up.
        if (!fdcVerification.verifyReferencedPaymentNonexistence(p)) revert ProofNotVerified();

        IReferencedPaymentNonexistence.Response memory data = p.data;
        IReferencedPaymentNonexistence.RequestBody memory req = data.requestBody;

        // 2. It is the attestation type we think it is, about the chain we think
        //    it is. A Payment proof and a nonexistence proof are different
        //    claims with compatible-looking shapes.
        if (data.attestationType != ATTESTATION_TYPE) {
            revert WrongAttestationType(data.attestationType);
        }
        if (data.sourceId != cfg.sourceId) revert WrongSourceId(data.sourceId);

        // 3. It is about *this* policy. The reference is derived from the policy
        //    address, so this is what stops a proof for one policy arming another.
        if (req.standardPaymentReference != cfg.paymentReference) {
            revert WrongPaymentReference(req.standardPaymentReference);
        }
        if (req.destinationAddressHash != cfg.destinationAddressHash) {
            revert WrongDestination(req.destinationAddressHash);
        }

        // 4. The attested threshold is at least what we require. A proof that
        //    "no payment of 1000 XRP arrived" must not fire a policy whose
        //    heartbeat is 0.1 XRP -- the owner may well have paid the smaller sum.
        if (req.amount < cfg.minimumAmount) {
            revert AmountTooLow(req.amount, cfg.minimumAmount);
        }

        // 5. The request did not restrict which senders count. With
        //    checkSourceAddresses set, an attacker picks a sourceAddressesRoot
        //    the owner never pays from, and nonexistence becomes trivially true
        //    while the owner has been paying all along. This is the subtlest
        //    hole in the whole contract and the cheapest to close.
        if (req.checkSourceAddresses) revert SourceAddressFilterNotAllowed();

        // 6. The deadline has actually passed, and it is a real deadline of this
        //    policy's schedule rather than an arbitrary instant chosen to make
        //    the window convenient.
        uint64 deadline = req.deadlineTimestamp;
        if (deadline > block.timestamp) revert DeadlineNotReached(deadline);
        if (deadline <= cfg.start || (deadline - cfg.start) % cfg.interval != 0) {
            revert DeadlineNotOnBoundary(deadline);
        }

        // 7. The attested window covers the whole interval leading up to that
        //    deadline. Without this a proof covering the final minute would
        //    do -- and the owner may have paid on the first day.
        uint64 windowStart = deadline - cfg.interval;
        if (data.responseBody.minimalBlockTimestamp > windowStart) {
            revert WindowDoesNotCoverInterval(data.responseBody.minimalBlockTimestamp, windowStart);
        }

        return true;
    }

    /// @inheritdoc ITrigger
    function kind() external pure returns (string memory) {
        return "fdc-nonexistence";
    }

    /// @notice The deadline the owner must pay by, given the current time.
    /// @dev View helper for the UI. Returns the next boundary at or after now.
    // forge-lint: disable-next-line(block-timestamp)
    function currentDeadline(address policy) external view returns (uint64) {
        Config storage cfg = configs[policy];
        if (cfg.owner == address(0)) revert NotConfigured();

        if (block.timestamp <= cfg.start) return cfg.start + cfg.interval;
        uint64 elapsed = uint64(block.timestamp) - cfg.start;
        return cfg.start + ((elapsed / cfg.interval) + 1) * cfg.interval;
    }

    /// @notice The reference a payment must carry to count for this policy.
    /// @dev Mirrored byte-for-byte in packages/policy/src/chain-payments.ts, and
    ///      asserted against a shared vector -- the browser tells the owner what
    ///      to put in the memo, and this contract decides whether it counted.
    ///      Two implementations of one derivation is exactly the drift the
    ///      commitment vectors exist to prevent, so it gets the same treatment.
    function policyReference(address policy) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("flare-studio.policy-reference.v1", policy));
    }
}
