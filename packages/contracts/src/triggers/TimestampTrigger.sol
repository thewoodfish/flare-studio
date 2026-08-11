// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ITrigger} from "../interfaces/ITrigger.sol";

/// @notice Fires once a fixed date has passed.
///
/// The cheapest possible ITrigger, and that is the point: template #2 needed a
/// new trigger and this file, nothing else. No change to ConfidentialPolicy, no
/// new field in the IR, no compiler branch. If a third template ever costs more
/// than this, the abstraction has leaked.
///
/// Note what this contract owns that the policy does not: the date. A
/// proof-of-life policy has no date and a scheduled one has no interval, which
/// is exactly why neither lives in ConfidentialPolicy.
contract TimestampTrigger is ITrigger {
    mapping(address policy => uint64) public executeAfter;

    event Configured(address indexed policy, uint64 executeAfter);

    error AlreadyConfigured();
    error NotConfigured();
    error TimestampInPast();

    /// @dev Called once per policy, by whoever is setting the policy up.
    ///      Write-once: a mutable date would let an owner postpone a
    ///      distribution indefinitely, which is the opposite of the guarantee
    ///      a scheduled policy is supposed to make to its recipients.
    function configure(address policy, uint64 executeAfter_) external {
        if (executeAfter[policy] != 0) revert AlreadyConfigured();
        // forge-lint: disable-next-line(block-timestamp)
        if (executeAfter_ <= block.timestamp) revert TimestampInPast();
        executeAfter[policy] = executeAfter_;
        emit Configured(policy, executeAfter_);
    }

    /// @inheritdoc ITrigger
    /// @dev forge-lint: the same reasoning as ManualHeartbeatTrigger. A validator
    ///      can move this by seconds; the dates are months out. Accepted
    ///      deliberately, not overlooked.
    // forge-lint: disable-next-line(block-timestamp)
    function check(address policy, bytes calldata) external view returns (bool) {
        uint64 target = executeAfter[policy];
        if (target == 0) revert NotConfigured();
        return block.timestamp > target;
    }

    /// @inheritdoc ITrigger
    function kind() external pure returns (string memory) {
        return "timestamp";
    }
}
