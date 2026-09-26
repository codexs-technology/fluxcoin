// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IFluxCoin
 * @notice Minimal interface used by FluxFaucet to mint earned balances on-chain.
 */
interface IFluxCoin {
    function mint(address to, uint256 amount) external;

    function decimals() external view returns (uint8);

    function balanceOf(address account) external view returns (uint256);
}
