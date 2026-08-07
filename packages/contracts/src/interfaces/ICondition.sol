// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice An additional predicate that must hold before a policy may arm.
///
/// Conditions are ANDed. Like triggers, a condition owns its own configuration --
/// an FTSO price condition holds its own feed id and threshold. The feed id is
/// configuration, never a constant in the policy.
interface ICondition {
    function isSatisfied(address policy) external view returns (bool);

    /// @notice Human-readable kind, e.g. "ftso-price-above", for indexing and UI.
    function kind() external pure returns (string memory);
}
