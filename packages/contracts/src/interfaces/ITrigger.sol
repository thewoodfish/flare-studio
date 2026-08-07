// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice What causes a policy to become eligible for execution.
///
/// Triggers own all of their own state. A proof-of-life trigger owns its interval
/// and deadline; a timestamp trigger owns its target date. The policy itself holds
/// none of it and knows nothing about why it fires -- see plan.md, "The genericity
/// constraint". If a new template requires adding a field to ConfidentialPolicy,
/// the abstraction is wrong.
interface ITrigger {
    /// @param policy The policy asking whether it may arm.
    /// @param proof  Opaque, trigger-specific evidence. Empty for triggers that read
    ///               only on-chain state; an encoded attestation response plus Merkle
    ///               proof for FDC-backed triggers.
    /// @return True if the trigger condition is met.
    ///
    /// @dev Deliberately non-view: proof-consuming triggers must be able to record
    ///      that a given proof has been used.
    function check(address policy, bytes calldata proof) external returns (bool);

    /// @notice Human-readable kind, e.g. "manual-heartbeat", for indexing and UI.
    function kind() external pure returns (string memory);
}
