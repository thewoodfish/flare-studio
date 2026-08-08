// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import {ITrigger} from "./interfaces/ITrigger.sol";
import {ICondition} from "./interfaces/ICondition.sol";
import {TeeAttestorGate} from "./TeeAttestorGate.sol";

/// @notice A vault plus a state machine. It does not know why it fires.
///
/// Note what is absent: no heartbeat interval, no deadline, no price threshold,
/// no notion of an heir or an estate. Trigger-specific state lives in the
/// ITrigger; condition-specific state in each ICondition. This contract governs
/// *an asset* under *a policy* and is reused unchanged by every template.
///
/// Confidentiality model:
///   - The private half of the policy (who receives what) never touches this
///     contract. Only `commitment` does -- a hash of the canonical distribution
///     set plus a salt.
///   - The TEE decrypts the policy inside the enclave, computes the distribution,
///     and signs it.
///   - execute() checks two things: the signer is an attested PRODUCTION machine,
///     and the revealed distribution hashes to the commitment fixed at deploy
///     time. Neither alone is sufficient. The first stops anyone else signing;
///     the second stops even an attested machine substituting a different payout.
contract ConfidentialPolicy is Initializable, EIP712 {
    using SafeERC20 for IERC20;

    /// @dev `recipient`, not `beneficiary`. Template vocabulary must not reach the
    ///      engine -- scripts/lint-genericity.sh enforces this in CI.
    ///
    ///      Shares, not amounts. The balance at execution time cannot be known
    ///      when the policy is written -- the entire point is that it fires at
    ///      some unknown future moment -- so the commitment is taken over
    ///      proportions and this contract does the arithmetic itself.
    ///
    ///      The security consequence is the important part: the TEE cannot choose
    ///      payout amounts at all. It authorises execution of a split that was
    ///      fixed at deploy time and is enforced here. Even a fully compromised
    ///      enclave cannot redirect funds or alter proportions.
    struct Share {
        address recipient;
        uint16 shareBps;
    }

    enum Status {
        Active,
        Triggered,
        Executed,
        Cancelled
    }

    bytes32 private constant SHARE_TYPEHASH =
        keccak256("Share(address recipient,uint16 shareBps)");

    bytes32 private constant EXECUTION_TYPEHASH =
        keccak256("Execution(bytes32 commitment,bytes32 sharesHash,uint256 triggeredAt)");

    uint256 private constant TOTAL_BPS = 10_000;

    address public owner;
    IERC20 public asset;
    bytes32 public commitment;
    TeeAttestorGate public attestorGate;
    ITrigger public trigger;
    ICondition[] public conditions;
    Status public status;
    uint256 public triggeredAt;

    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event Armed(uint256 triggeredAt);
    event PolicyExecuted(address indexed teeId, uint256 totalDistributed);
    event Cancelled();

    error NotOwner();
    error WrongStatus(Status expected, Status actual);
    error TriggerNotMet();
    error ConditionNotMet(uint256 index);
    error SignerNotAttested(address signer);
    error CommitmentMismatch();
    error NothingToDistribute();
    error SharesDoNotSumToTotal(uint256 totalBps);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier inStatus(Status expected) {
        if (status != expected) revert WrongStatus(expected, status);
        _;
    }

    /// @dev The EIP712 constructor runs once, on the implementation. Clones
    ///      delegatecall into that bytecode, so name and version are shared, while
    ///      OpenZeppelin's cache check (address(this) != _cachedThis inside a clone)
    ///      rebuilds the domain separator per clone. No upgradeable variant needed.
    constructor() EIP712("FlareStudioPolicy", "1") {
        _disableInitializers();
    }

    /// @dev Clone initializer. Because the EIP-712 domain separator is derived from
    ///      address(this), every clone gets its own domain -- which is what makes a
    ///      signature for one policy useless against another.
    function initialize(
        address owner_,
        address asset_,
        bytes32 commitment_,
        address attestorGate_,
        address trigger_,
        address[] calldata conditions_
    ) external initializer {
        owner = owner_;
        asset = IERC20(asset_);
        commitment = commitment_;
        attestorGate = TeeAttestorGate(attestorGate_);
        trigger = ITrigger(trigger_);
        for (uint256 i = 0; i < conditions_.length; i++) {
            conditions.push(ICondition(conditions_[i]));
        }
        status = Status.Active;
    }

    // --- funding -------------------------------------------------------------

    function deposit(uint256 amount) external inStatus(Status.Active) {
        asset.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external onlyOwner inStatus(Status.Active) {
        asset.safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    /// @notice Owner's escape hatch while the policy has not yet fired.
    function cancel() external onlyOwner inStatus(Status.Active) {
        status = Status.Cancelled;
        uint256 remaining = asset.balanceOf(address(this));
        if (remaining > 0) asset.safeTransfer(owner, remaining);
        emit Cancelled();
    }

    // --- arming --------------------------------------------------------------

    /// @notice Move Active -> Triggered once the trigger fires and every condition holds.
    /// @dev Permissionless by design. Arming reveals nothing and moves no funds; it
    ///      only records that the world reached the state the owner specified. Making
    ///      it owner-only would defeat the entire purpose of a policy that must work
    ///      when the owner cannot act.
    function arm(bytes calldata proof) external inStatus(Status.Active) {
        if (!trigger.check(address(this), proof)) revert TriggerNotMet();

        for (uint256 i = 0; i < conditions.length; i++) {
            if (!conditions[i].isSatisfied(address(this))) revert ConditionNotMet(i);
        }

        status = Status.Triggered;
        triggeredAt = block.timestamp;
        emit Armed(block.timestamp);
    }

    // --- execution -----------------------------------------------------------

    /// @notice Reveal the committed split and pay it out.
    /// @param shares The revealed share set -- must hash to the stored commitment.
    /// @param salt   The salt committed to at deploy time. Without it the
    ///               commitment would be brute-forceable: a recipient set is
    ///               low-entropy, and an attacker who guessed it could confirm
    ///               the guess against the on-chain hash.
    /// @param sig    EIP-712 signature from an attested TEE machine.
    function execute(Share[] calldata shares, bytes32 salt, bytes calldata sig)
        external
        inStatus(Status.Triggered)
    {
        if (keccak256(abi.encode(shares, salt)) != commitment) revert CommitmentMismatch();

        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(EXECUTION_TYPEHASH, commitment, _hashShares(shares), triggeredAt)
            )
        );
        address signer = ECDSA.recover(digest, sig);
        if (!attestorGate.isAttested(signer)) revert SignerNotAttested(signer);

        uint256 totalBps;
        for (uint256 i = 0; i < shares.length; i++) {
            totalBps += shares[i].shareBps;
        }
        if (totalBps != TOTAL_BPS) revert SharesDoNotSumToTotal(totalBps);

        uint256 available = asset.balanceOf(address(this));
        if (available == 0) revert NothingToDistribute();

        // Set before transferring: these are arbitrary token contracts and a
        // malicious asset could re-enter. Status is the reentrancy guard.
        status = Status.Executed;

        // The last recipient absorbs the integer-division remainder so the sum
        // is exactly the balance. Dust left behind would be stranded forever --
        // the policy is Executed and can never fire again.
        uint256 allocated;
        for (uint256 i = 0; i < shares.length; i++) {
            uint256 amount = i == shares.length - 1
                ? available - allocated
                : (available * shares[i].shareBps) / TOTAL_BPS;
            allocated += amount;
            asset.safeTransfer(shares[i].recipient, amount);
        }

        emit PolicyExecuted(signer, available);
    }

    function _hashShares(Share[] calldata shares) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](shares.length);
        for (uint256 i = 0; i < shares.length; i++) {
            hashes[i] =
                keccak256(abi.encode(SHARE_TYPEHASH, shares[i].recipient, shares[i].shareBps));
        }
        return keccak256(abi.encodePacked(hashes));
    }

    // --- views ---------------------------------------------------------------

    function conditionCount() external view returns (uint256) {
        return conditions.length;
    }

    function balance() external view returns (uint256) {
        return asset.balanceOf(address(this));
    }
}
