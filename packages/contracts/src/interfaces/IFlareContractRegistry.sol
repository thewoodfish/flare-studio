// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Flare's canonical address book.
///
/// The registry lives at the same address on every Flare network, which makes it
/// the one address it is safe to treat as a constant. Everything else -- asset
/// managers, the TEE manager, FTSO, FDC verification -- is resolved through it
/// at deploy time.
///
/// This matters more than it looks. Coston2's confidential compute stack was
/// redeployed once already, and the documented top failure mode for teams is a
/// stale hardcoded address producing FunctionNotFound. Resolving dynamically
/// costs one call and removes that whole class of breakage.
interface IFlareContractRegistry {
    function getContractAddressByName(string calldata name) external view returns (address);
}

/// @notice The FAsset manager for a given underlying asset.
interface IAssetManager {
    /// @return The ERC-20 FAsset token address, e.g. FXRP.
    function fAsset() external view returns (address);
}
