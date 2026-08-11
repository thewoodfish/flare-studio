// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// TODO: Replace local interfaces with imports from flare-smart-contracts-v2 once published as a package.
import { ITeeExtensionRegistry } from "./interfaces/ITeeExtensionRegistry.sol";
import { ITeeMachineRegistry } from "./interfaces/ITeeMachineRegistry.sol";

/// @title PolicyInstructionSender
/// @author Flare Studio
/// @notice On-chain entry point for sending confidential policy instructions to the TEE.
///
/// DO NOT MODIFY: constructor, setExtensionId(), _getExtensionId()
contract PolicyInstructionSender {
    /// @notice Operation type for confidential policy actions (STORE, EVALUATE).
    /// @dev Deliberately `POLICY`, never `F_POLICY`. The `F_` prefix is reserved for
    ///      Flare system operations (op.Type in go-flare-common), and `F_POLICY` is a
    ///      real one -- governance policy, nothing to do with ours. op.IsValid() only
    ///      admits a non-system type when it does *not* carry the prefix, so a
    ///      collision here would mean instructions silently never reach the extension.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_TYPE_POLICY = bytes32("POLICY");

    /// @notice Command to hand the enclave the encrypted private half of a policy.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_STORE = bytes32("STORE");

    /// @notice Command to evaluate a stored policy and sign the resulting distribution.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_EVALUATE = bytes32("EVALUATE");

    /// @notice Reference to the TEE extension registry contract.
    ITeeExtensionRegistry public immutable TEE_EXTENSION_REGISTRY;
    /// @notice Reference to the TEE machine registry contract.
    ITeeMachineRegistry public immutable TEE_MACHINE_REGISTRY;

    /// @notice First public extension ID. The registry reserves IDs below this
    /// for system/reserved extensions; public extensions are assigned from here up.
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000; // 65536

    uint256 private _extensionId;

    /// @notice Payload for the STORE instruction.
    /// @dev The ciphertext is ECIES-encrypted to the TEE machine's public key by the
    ///      browser. It travels on-chain precisely so that no server of ours ever sees
    ///      it -- data providers relay opaque bytes and only the enclave can open them.
    struct StorePolicyMessage {
        address policy;
        bytes ciphertext;
    }

    /// @notice Payload for the EVALUATE instruction.
    /// @dev `triggeredAt` is caller-supplied and deliberately untrusted. It binds the
    ///      signature to one arming of one policy; ConfidentialPolicy.execute rebuilds
    ///      the same digest from its own stored `triggeredAt`, so a wrong value here
    ///      yields a signature that simply fails to recover. That keeps the enclave
    ///      free of any need for chain access.
    struct EvaluatePolicyMessage {
        address policy;
        uint256 triggeredAt;
    }

    /// @notice Initializes the contract with registry addresses.
    /// @param _teeExtensionRegistry Address of the TEE extension registry.
    /// @param _teeMachineRegistry Address of the TEE machine registry.
    constructor(
        ITeeExtensionRegistry _teeExtensionRegistry,
        ITeeMachineRegistry _teeMachineRegistry
    ) {
        require(address(_teeExtensionRegistry) != address(0), "TeeExtensionRegistry cannot be zero address");
        require(address(_teeMachineRegistry) != address(0), "TeeMachineRegistry cannot be zero address");
        require(address(_teeExtensionRegistry).code.length > 0, "TeeExtensionRegistry has no code");
        require(address(_teeMachineRegistry).code.length > 0, "TeeMachineRegistry has no code");
        TEE_EXTENSION_REGISTRY = _teeExtensionRegistry;
        TEE_MACHINE_REGISTRY = _teeMachineRegistry;
    }

    /// @notice Finds and sets this contract's extension id. Can only be set once.
    /// DO NOT MODIFY this function.
    function setExtensionId() external {
        require(_extensionId == 0, "Extension ID already set.");

        uint256 c = TEE_EXTENSION_REGISTRY.nextPublicExtensionId();
        for (uint256 i = FIRST_PUBLIC_EXTENSION_ID; i < c; ++i) {
            if (TEE_EXTENSION_REGISTRY.getTeeExtensionInstructionsSender(i) == address(this)) {
                _extensionId = i;
                return;
            }
        }
        revert("Extension ID not found.");
    }

    /// @notice Sends a STORE instruction, handing the enclave a policy's private half.
    /// @param _policy The ConfidentialPolicy clone the ciphertext belongs to.
    /// @param _ciphertext ECIES ciphertext of the canonical privateConfig JSON.
    function sendStorePolicy(address _policy, bytes calldata _ciphertext) external payable {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_POLICY,
            opCommand: OP_COMMAND_STORE,
            message: abi.encode(StorePolicyMessage({policy: _policy, ciphertext: _ciphertext})),
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(
            teeIds,
            params
        );
    }

    /// @notice Sends an EVALUATE instruction, asking the enclave to sign a distribution.
    /// @param _policy The ConfidentialPolicy clone to evaluate.
    /// @param _triggeredAt The policy's arming timestamp, which binds the signature.
    function sendEvaluatePolicy(address _policy, uint256 _triggeredAt) external payable {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);

        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_POLICY,
            opCommand: OP_COMMAND_EVALUATE,
            message: abi.encode(EvaluatePolicyMessage({policy: _policy, triggeredAt: _triggeredAt})),
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });

        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(
            teeIds,
            params
        );
    }

    /// @notice Returns the cached extension ID, reverting if not yet set.
    /// @return The extension ID assigned to this contract.
    function _getExtensionId() internal view returns (uint256) {
        require(_extensionId != 0, "Extension ID is not set.");
        return _extensionId;
    }
}
