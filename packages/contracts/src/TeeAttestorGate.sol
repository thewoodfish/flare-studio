// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IFlareTeeManager} from "./interfaces/IFlareTeeManager.sol";

/// @notice Decides whether a signing address is a live, attested TEE machine.
///
/// This is the entire Bounty 2 enforcement surface, and it is deliberately thin:
/// Flare already operates the registry, the attestation, and the data-provider
/// consensus behind it. Our job is to *consult* that, not to reimplement it.
///
/// The security claim of the whole product reduces to one line in
/// ConfidentialPolicy.execute: the recovered signer must be PRODUCTION here.
/// Only a registered, attested machine running approved code can authorise a
/// distribution.
contract TeeAttestorGate {
    /// @dev Machine lifecycle: 1 = INITIALIZED, 2 = PRODUCTION. A machine that has
    ///      registered but is not yet serving data providers sits at INITIALIZED,
    ///      and must not be able to authorise anything.
    uint8 internal constant STATUS_PRODUCTION = 2;

    IFlareTeeManager public immutable teeManager;

    error ManagerNotSet();

    /// @param teeManager_ Read from config/coston2/deployed-addresses.json at deploy
    ///        time. Never a literal in source -- the Coston2 redeploy is precisely
    ///        why hardcoding this is a known failure mode.
    constructor(address teeManager_) {
        if (teeManager_ == address(0)) revert ManagerNotSet();
        teeManager = IFlareTeeManager(teeManager_);
    }

    /// @notice True only for machines Flare currently reports as PRODUCTION.
    /// @dev Staleness handling is intentionally Flare's problem, not ours: if a
    ///      machine is deregistered or falls out of production, this goes false on
    ///      the next call with no action required here.
    function isAttested(address teeId) external view returns (bool) {
        return teeManager.getTeeMachineStatus(teeId) == STATUS_PRODUCTION;
    }
}
