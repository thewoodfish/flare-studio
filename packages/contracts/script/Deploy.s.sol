// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console} from "forge-std/Script.sol";

import {ConfidentialPolicy} from "../src/ConfidentialPolicy.sol";
import {PolicyFactory} from "../src/PolicyFactory.sol";
import {TeeAttestorGate} from "../src/TeeAttestorGate.sol";
import {ManualHeartbeatTrigger} from "../src/triggers/ManualHeartbeatTrigger.sol";
import {IFlareContractRegistry, IAssetManager} from "../src/interfaces/IFlareContractRegistry.sol";

/// @notice Deploys the policy engine to Coston2.
///
///     forge script script/Deploy.s.sol --rpc-url coston2 --broadcast
///
/// Requires DEPLOYER_PRIVATE_KEY and TEE_MANAGER_ADDRESS in the environment.
/// TEE_MANAGER_ADDRESS comes from the FCC scaffold's
/// config/coston2/deployed-addresses.json -- never from a chat message or an
/// older guide, per Flare's own troubleshooting notes.
contract Deploy is Script {
    /// @dev The one address that is genuinely constant across Flare networks.
    address internal constant REGISTRY = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address teeManager = vm.envAddress("TEE_MANAGER_ADDRESS");

        address fxrp = _resolveFAsset("AssetManagerFXRP");
        console.log("FXRP resolved from registry:", fxrp);

        vm.startBroadcast(pk);

        ConfidentialPolicy implementation = new ConfidentialPolicy();
        PolicyFactory factory = new PolicyFactory(address(implementation));
        TeeAttestorGate gate = new TeeAttestorGate(teeManager);
        ManualHeartbeatTrigger heartbeat = new ManualHeartbeatTrigger();

        vm.stopBroadcast();

        console.log("");
        console.log("=== Flare Studio deployed ===");
        console.log("implementation        ", address(implementation));
        console.log("PolicyFactory         ", address(factory));
        console.log("TeeAttestorGate       ", address(gate));
        console.log("ManualHeartbeatTrigger", address(heartbeat));
        console.log("FXRP                  ", fxrp);
        console.log("FlareTeeManager       ", teeManager);

        _writeAddresses(address(factory), address(gate), address(heartbeat), fxrp);
    }

    /// @dev Registry -> AssetManager -> fAsset(). Three hops, zero hardcoded
    ///      token addresses, and it keeps working when FAssets are redeployed.
    function _resolveFAsset(string memory managerName) internal view returns (address) {
        address manager = IFlareContractRegistry(REGISTRY).getContractAddressByName(managerName);
        require(manager != address(0), string.concat("registry has no entry for ", managerName));
        return IAssetManager(manager).fAsset();
    }

    /// @dev Emitted as JSON so the web app and orchestrator read addresses from
    ///      one generated file rather than each keeping their own copy.
    function _writeAddresses(address factory, address gate, address trigger, address fxrp)
        internal
    {
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "policyFactory": "', vm.toString(factory), '",\n',
            '  "teeAttestorGate": "', vm.toString(gate), '",\n',
            '  "manualHeartbeatTrigger": "', vm.toString(trigger), '",\n',
            '  "fxrp": "', vm.toString(fxrp), '"\n',
            "}\n"
        );
        vm.writeFile("./deployments/coston2.json", json);
        console.log("");
        console.log("wrote ./deployments/coston2.json");
    }
}
