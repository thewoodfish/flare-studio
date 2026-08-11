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
    ///
    ///      The try/catch is not defensive boilerplate. The live manager on Coston2
    ///      *reverts* with a typed error for an address it has never seen, rather
    ///      than returning 0 -- verified in TeeAttestorGateFork.t.sol. Without this,
    ///      an execute signed by an unregistered key would revert with an opaque
    ///      `0xceb05b68` from a Flare contract instead of our own SignerNotAttested,
    ///      and the unit tests asserting that error would be describing behaviour
    ///      that never occurs in production.
    ///
    ///      Failing closed is the only safe direction here: every failure mode of
    ///      the call -- unregistered, wrong address, manager paused -- becomes "not
    ///      attested", which blocks execution rather than permitting it.
    function isAttested(address teeId) external view returns (bool) {
        try teeManager.getTeeMachineStatus(teeId) returns (uint8 status) {
            return status == STATUS_PRODUCTION;
        } catch {
            return false;
        }
    }
}
