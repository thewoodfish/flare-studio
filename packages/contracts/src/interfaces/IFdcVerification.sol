// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IReferencedPaymentNonexistence} from "./IReferencedPaymentNonexistence.sol";

/// @notice The one function we need from Flare's FDC verifier.
///
/// Declared narrowly on purpose, the same way IFlareTeeManager is: we consume
/// Flare's attestation infrastructure rather than reimplementing any of it, and
/// a smaller declared surface is a smaller thing to get wrong.
///
/// Resolved from FlareContractRegistry under "FdcVerification" -- never a literal.
/// Note there are two verifiers deployed on Coston2: this one answers
/// `fdcProtocolId()` with 200 and implements this interface, while
/// `Fdc2Verification` reverts on that call and is a different generation. Picking
/// the wrong one compiles perfectly and fails at the only moment that matters.
interface IFdcVerification {
    /// @return True if the Merkle proof places this attestation in a finalised
    ///         FDC voting round. False means unproven -- it does not mean the
    ///         payment happened.
    function verifyReferencedPaymentNonexistence(
        IReferencedPaymentNonexistence.Proof calldata _proof
    ) external view returns (bool);

    /// @notice 200 for FDC. Used here only to sanity-check the wiring.
    function fdcProtocolId() external view returns (uint8);
}
