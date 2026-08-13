// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";

import {FdcNonexistenceTrigger} from "../src/triggers/FdcNonexistenceTrigger.sol";
import {IFdcVerification} from "../src/interfaces/IFdcVerification.sol";
import {IReferencedPaymentNonexistence as IRPN} from
    "../src/interfaces/IReferencedPaymentNonexistence.sol";

contract StubVerifier is IFdcVerification {
    function verifyReferencedPaymentNonexistence(IRPN.Proof calldata)
        external
        pure
        returns (bool)
    {
        return true;
    }

    function fdcProtocolId() external pure returns (uint8) {
        return 200;
    }
}

/// @notice The payment reference, asserted against bytes TypeScript produced.
///
/// The same discipline as CommitmentVectors, and for the same reason. This
/// derivation exists twice: the browser tells an owner what to put in their
/// proof-of-life payment, and this contract decides whether what arrived
/// counted. If the two drift, an owner who has paid faithfully every month is
/// judged to have paid nothing — and the failure is silent until their policy
/// fires while they are alive.
///
/// Reading the fixture rather than copying its values is the whole point: a copy
/// would not notice when the source changed.
contract PolicyReferenceVectorsTest is Test {
    using stdJson for string;

    FdcNonexistenceTrigger internal trigger;

    function setUp() public {
        trigger = new FdcNonexistenceTrigger(address(new StubVerifier()));
    }

    function test_solidityMatchesTypeScriptVectors() public view {
        string memory json =
            vm.readFile("../policy/fixtures/policy-reference-vectors.json");

        // The tag is part of the derivation; a changed tag changes every
        // reference, so it is asserted rather than assumed.
        assertEq(
            json.readString(".tag"),
            "flare-studio.policy-reference.v1",
            "domain tag drifted between TypeScript and Solidity"
        );

        for (uint256 i = 0; i < 5; i++) {
            string memory base = string.concat(".cases[", vm.toString(i), "]");
            address policy = json.readAddress(string.concat(base, ".policy"));
            bytes32 expected = json.readBytes32(string.concat(base, ".reference"));

            assertEq(
                trigger.policyReference(policy),
                expected,
                "policyReference disagrees with the TypeScript implementation"
            );
        }
    }

    /// @dev Different policies must never share a reference, or a proof about
    ///      one would arm the other.
    function test_referencesAreDistinctPerPolicy() public view {
        assertTrue(
            trigger.policyReference(address(1)) != trigger.policyReference(address(2)),
            "two policies derived the same reference"
        );
    }
}
