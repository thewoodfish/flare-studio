// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console} from "forge-std/Test.sol";

import {TeeAttestorGate} from "../src/TeeAttestorGate.sol";
import {IFlareTeeManager} from "../src/interfaces/IFlareTeeManager.sol";

/// @notice The gate, against the real FlareTeeManager on Coston2.
///
/// MockTeeManager proves our logic; this proves our integration. The gap between
/// them is the only place the Bounty 2 claim can quietly rot: if the deployed
/// manager's ABI differs from IFlareTeeManager by so much as a return type, every
/// unit test still passes and every real execution reverts.
///
/// Skips rather than fails when the fork is unavailable, so a working tree
/// without network access stays green. A skipped run prints why.
contract TeeAttestorGateForkTest is Test {
    /// @dev From apps/extension/config/coston2/deployed-addresses.json, which is
    ///      the only source Flare's own troubleshooting guide accepts. Coston2 FCC
    ///      has been redeployed once already; a literal copied from chat or an
    ///      older guide is the single most common way this stack breaks.
    address internal constant FLARE_TEE_MANAGER = 0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE;

    TeeAttestorGate internal gate;
    bool internal forked;

    function setUp() public {
        try vm.createSelectFork("coston2") {
            forked = true;
        } catch {
            return;
        }
        gate = new TeeAttestorGate(FLARE_TEE_MANAGER);
    }

    modifier onlyForked() {
        if (!forked) {
            console.log("SKIPPED: could not reach the coston2 RPC");
            vm.skip(true);
        }
        _;
    }

    /// @dev The manager's own typed error for an address it has never seen.
    ///      Pinned as a literal because that is what the fork returns and what we
    ///      are asserting: seeing *this* error proves getTeeMachineStatus executed
    ///      its own body, rather than our call landing on the proxy fallback --
    ///      which is what a wrong selector or a stale address would look like.
    bytes4 internal constant UNREGISTERED_MACHINE = 0xceb05b68;

    /// @notice The deployed manager implements the selector we declare.
    ///
    /// @dev The point of the whole file. If the live contract does not answer this
    ///      selector, our interface is wrong, every mock-based test is measuring
    ///      nothing, and we would only find out during a live execution.
    function test_fork_managerImplementsOurSelector() public onlyForked {
        assertGt(FLARE_TEE_MANAGER.code.length, 0, "no contract at the manager address");

        vm.expectRevert(UNREGISTERED_MACHINE);
        IFlareTeeManager(FLARE_TEE_MANAGER).getTeeMachineStatus(
            makeAddr("definitely-not-a-tee-machine")
        );
    }

    /// @notice An unregistered address is not attested -- and does not revert.
    ///
    /// @dev This is the assertion the gate's try/catch exists to satisfy. Before it,
    ///      this call reverted with the manager's error, which meant
    ///      ConfidentialPolicy.execute could never produce SignerNotAttested in
    ///      production no matter what the unit tests said.
    function test_fork_unregisteredAddressIsNotAttested() public onlyForked {
        assertFalse(gate.isAttested(makeAddr("definitely-not-a-tee-machine")));
    }

    /// @notice The gate must not invent an attestation for the zero address.
    function test_fork_zeroAddressIsNotAttested() public onlyForked {
        assertFalse(gate.isAttested(address(0)));
    }
}
