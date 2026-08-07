// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Minimal view of Flare Confidential Compute's TEE machine registry.
///
/// We deliberately declare only what we consume. The full manager is Flare's;
/// building our own registry would be duplicating infrastructure that already
/// exists and is already trusted -- see plan.md, TeeAttestorGate.
///
/// Verified live on Coston2: both selectors execute and revert with a typed
/// custom error for an unregistered address, while an unknown selector hits the
/// proxy fallback instead.
///
/// The address is NOT hardcoded anywhere in this repo. Flare's troubleshooting
/// guide is explicit: resolve system addresses from
/// config/coston2/deployed-addresses.json, never from chat or older docs.
/// Coston2 FCC has already been redeployed once, which is what broke most
/// teams' stacks.
interface IFlareTeeManager {
    /// @return status 0 = unknown, 1 = INITIALIZED, 2 = PRODUCTION.
    function getTeeMachineStatus(address teeId) external view returns (uint8 status);

    function getTeeMachine(address teeId)
        external
        view
        returns (address owner, address machine, string memory url);
}
