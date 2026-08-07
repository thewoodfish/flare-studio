// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ITrigger} from "../interfaces/ITrigger.sol";

/// @notice Proof-of-life by on-chain check-in.
///
/// This is the day-1 trigger and the demo fallback. The real one is
/// FdcNonexistenceTrigger, which proves via Flare's Data Connector that an
/// expected XRPL payment did *not* arrive -- genuine attested absence rather
/// than a self-reported timer.
///
/// Both implement ITrigger and are interchangeable at deploy time. Building this
/// first means the whole product works end to end before FDC is integrated,
/// which is what keeps FDC an upgrade rather than a dependency.
///
/// Note this contract owns `interval` and `deadline`. ConfidentialPolicy holds
/// neither -- a scheduled-distribution policy has no heartbeat at all.
contract ManualHeartbeatTrigger is ITrigger {
    struct Config {
        address owner;
        uint64 interval;
        uint64 deadline;
        bool demoMode;
    }

    mapping(address policy => Config) public configs;

    event Configured(address indexed policy, uint64 interval, bool demoMode);
    event Heartbeat(address indexed policy, uint64 newDeadline);
    event InactivitySimulated(address indexed policy);

    error AlreadyConfigured();
    error NotConfigured();
    error NotPolicyOwner();
    error DemoModeDisabled();
    error IntervalTooShort();

    /// @dev Called once per policy, by whoever is setting the policy up.
    function configure(address policy, address owner, uint64 interval, bool demoMode) external {
        if (configs[policy].owner != address(0)) revert AlreadyConfigured();
        if (interval == 0) revert IntervalTooShort();
        configs[policy] = Config({
            owner: owner,
            interval: interval,
            deadline: uint64(block.timestamp) + interval,
            demoMode: demoMode
        });
        emit Configured(policy, interval, demoMode);
    }

    /// @notice "I am still here." Pushes the deadline out by one interval.
    function heartbeat(address policy) external {
        Config storage c = configs[policy];
        if (c.owner == address(0)) revert NotConfigured();
        if (msg.sender != c.owner) revert NotPolicyOwner();
        c.deadline = uint64(block.timestamp) + c.interval;
        emit Heartbeat(policy, c.deadline);
    }

    /// @notice Demo control: yank the deadline into the past.
    /// @dev You cannot fast-forward Coston2, and a twelve-month timer does not
    ///      demo. This exists so step 4 of the demo is deterministic. It is inert
    ///      unless demoMode was set at configuration time, and the UI labels it
    ///      as a demo control rather than hiding it -- pretending time passed
    ///      would be worse than showing the seam.
    function simulateInactivity(address policy) external {
        Config storage c = configs[policy];
        if (c.owner == address(0)) revert NotConfigured();
        if (msg.sender != c.owner) revert NotPolicyOwner();
        if (!c.demoMode) revert DemoModeDisabled();
        c.deadline = uint64(block.timestamp) - 1;
        emit InactivitySimulated(policy);
    }

    /// @inheritdoc ITrigger
    /// @dev forge-lint: block.timestamp is manipulable by a validator, by seconds.
    ///      Deadlines here are months. A validator who could shift the trigger by
    ///      fifteen seconds gains nothing, and the owner's remedy -- send a
    ///      heartbeat -- is always available. Accepted deliberately, not overlooked.
    // forge-lint: disable-next-line(block-timestamp)
    function check(address policy, bytes calldata) external view returns (bool) {
        Config storage c = configs[policy];
        if (c.owner == address(0)) revert NotConfigured();
        return block.timestamp > c.deadline;
    }

    /// @inheritdoc ITrigger
    function kind() external pure returns (string memory) {
        return "manual-heartbeat";
    }

    function deadlineOf(address policy) external view returns (uint64) {
        return configs[policy].deadline;
    }
}
