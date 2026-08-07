// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ConfidentialPolicy} from "./ConfidentialPolicy.sol";

/// @notice Deploys policies as minimal proxies.
///
/// Each policy gets its own address, which is what makes "deploy a policy" mean
/// something concrete in the Deployment Manager -- a real contract, a real
/// explorer link -- rather than a row in a table keyed by id.
///
/// The Deployment Manager reads its entire history from PolicyDeployed. No
/// indexer, no backend: the chain is the source of truth for what a user owns.
contract PolicyFactory {
    address public immutable implementation;

    event PolicyDeployed(
        address indexed policy,
        address indexed owner,
        address indexed asset,
        bytes32 commitment,
        address trigger
    );

    constructor(address implementation_) {
        implementation = implementation_;
    }

    function deploy(
        address asset,
        bytes32 commitment,
        address attestorGate,
        address trigger,
        address[] calldata conditions
    ) external returns (address policy) {
        policy = Clones.clone(implementation);
        ConfidentialPolicy(policy).initialize(
            msg.sender, asset, commitment, attestorGate, trigger, conditions
        );
        emit PolicyDeployed(policy, msg.sender, asset, commitment, trigger);
    }

    /// @notice Address a policy would get from a given salt, for deterministic deploys.
    function predictDeterministic(bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, salt, address(this));
    }
}
