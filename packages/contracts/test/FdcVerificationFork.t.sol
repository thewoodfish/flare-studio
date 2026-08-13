// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test, console} from "forge-std/Test.sol";

import {IFdcVerification} from "../src/interfaces/IFdcVerification.sol";
import {IReferencedPaymentNonexistence as IRPN} from
    "../src/interfaces/IReferencedPaymentNonexistence.sol";
import {IFlareContractRegistry} from "../src/interfaces/IFlareContractRegistry.sol";

/// @notice Our IFdcVerification against the one actually deployed on Coston2.
///
/// The unit tests mock the verifier, so they prove what we do with an answer and
/// nothing about whether we can ask the question. That gap is where this session
/// already lost an afternoon once: `IFlareTeeManager` looked right, the mock
/// agreed with it, and the live contract behaved differently.
///
/// There is a specific trap here. Coston2 has two verifiers deployed --
/// `FdcVerification` and `Fdc2Verification` — and they are different
/// generations. The wrong one compiles, deploys, and fails at execution.
contract FdcVerificationForkTest is Test {
    address internal constant REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    IFdcVerification internal verification;
    bool internal forked;

    function setUp() public {
        try vm.createSelectFork("coston2") {
            forked = true;
        } catch {
            return;
        }
        verification = IFdcVerification(
            IFlareContractRegistry(REGISTRY).getContractAddressByName("FdcVerification")
        );
    }

    modifier onlyForked() {
        if (!forked) {
            console.log("SKIPPED: could not reach the coston2 RPC");
            vm.skip(true);
        }
        _;
    }

    /// @dev Resolving by name rather than by literal is what keeps this working
    ///      through a redeploy, which Coston2 has already had once.
    function test_fork_registryResolvesTheVerifier() public onlyForked {
        assertTrue(address(verification) != address(0), "registry has no FdcVerification");
        assertGt(address(verification).code.length, 0, "resolved address has no code");
    }

    /// @notice 200 is FDC. This is the cheap way to tell the two verifiers apart.
    ///
    /// @dev `Fdc2Verification` reverts on this call. If this assertion ever fails,
    ///      the registry has been repointed at the other generation and
    ///      `verifyReferencedPaymentNonexistence` will not behave as we expect.
    function test_fork_isTheFdcGenerationWeExpect() public onlyForked {
        assertEq(verification.fdcProtocolId(), 200);
    }

    /// @notice The selector we depend on exists and decodes our struct layout.
    ///
    /// @dev An invented proof cannot be in any Merkle root, so `false` is the
    ///      only correct answer. What is being asserted is that the call
    ///      *executes* -- a wrong struct layout or a missing function would
    ///      revert instead, and that is the failure this test exists to catch.
    function test_fork_acceptsOurProofLayoutAndRejectsAFabricatedProof() public onlyForked {
        IRPN.Proof memory p;
        p.merkleProof = new bytes32[](0);
        p.data.attestationType = bytes32("ReferencedPaymentNonexistence");
        p.data.sourceId = bytes32("testXRP");
        p.data.votingRound = 1;
        p.data.requestBody.deadlineTimestamp = uint64(block.timestamp);
        p.data.requestBody.amount = 100_000;
        p.data.requestBody.standardPaymentReference = keccak256("not a real reference");

        assertFalse(
            verification.verifyReferencedPaymentNonexistence(p),
            "a fabricated proof verified, which would be catastrophic"
        );
    }
}
