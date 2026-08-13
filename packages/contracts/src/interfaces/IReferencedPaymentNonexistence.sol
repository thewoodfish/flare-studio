// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Flare's ReferencedPaymentNonexistence attestation type.
///
/// Transcribed field-for-field from Flare's own interface. The ordering matters:
/// these structs are ABI-decoded from calldata produced by the verifier, so a
/// reordered or renamed field changes the layout and decodes to nonsense rather
/// than failing loudly.
///
/// What the attestation says, in one sentence: no payment carrying
/// `standardPaymentReference`, of at least `amount`, to `destinationAddressHash`,
/// arrived on the source chain before `deadlineTimestamp`.
///
/// That is the primitive the whole product turns on. A smart contract cannot
/// normally observe an absence -- it can only see what did happen. FDC's
/// data-provider consensus is what makes "nothing arrived" a provable statement.
interface IReferencedPaymentNonexistence {
    struct RequestBody {
        uint64 minimalBlockNumber;
        uint64 deadlineBlockNumber;
        uint64 deadlineTimestamp;
        bytes32 destinationAddressHash;
        uint256 amount;
        bytes32 standardPaymentReference;
        /// @dev Restricting which senders count. We require this to be false --
        ///      see FdcNonexistenceTrigger for why it is an attack surface.
        bool checkSourceAddresses;
        bytes32 sourceAddressesRoot;
    }

    struct ResponseBody {
        uint64 minimalBlockTimestamp;
        uint64 firstOverflowBlockNumber;
        uint64 firstOverflowBlockTimestamp;
    }

    struct Response {
        bytes32 attestationType;
        bytes32 sourceId;
        uint64 votingRound;
        uint64 lowestUsedTimestamp;
        RequestBody requestBody;
        ResponseBody responseBody;
    }

    struct Proof {
        bytes32[] merkleProof;
        Response data;
    }
}
