// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title FluxCoin (FLUX)
 * @notice Production ERC-20 token for the FluxCoin faucet platform.
 *
 *  IMPORTANT DESIGN DECISIONS
 *  --------------------------
 *  1. 100% STANDARD ERC-20: `transfer` / `transferFrom` move EXACTLY the requested
 *     amount. There is NO fee-on-transfer hook (the legacy `FlashToken.sol` skimmed
 *     0.05% inside `transfer`, which breaks Uniswap router accounting, breaks
 *     `transferFrom`, and gets deposits rejected by centralised exchanges).
 *  2. `decimals()` is hard-pinned to 18 and can never be changed => the token is
 *     accepted by CEX listing pipelines and DEX routers without special handling.
 *  3. Minting is NOT public and NOT owner-only: only accounts holding
 *     `MINTER_ROLE` (the website backend hot wallet + the FluxFaucet claim
 *     contract) can mint. Users can never mint to themselves.
 *  4. `maxSupply` is immutable and enforced, which makes the inflation schedule
 *     auditable by exchanges / DEX LPs.
 */
contract FluxCoin is ERC20, ERC20Permit, ERC20Burnable, AccessControl {
    /// @notice Role required to mint new tokens (granted to the backend minter + faucet).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Hard cap on total supply (18 decimals).
    uint256 public immutable maxSupply;

    /// @notice Emitted on every backend/faucet mint for on-chain auditability.
    event BackendMint(address indexed to, uint256 amount, string reason);

    /**
     * @param admin Address that receives DEFAULT_ADMIN_ROLE and MINTER_ROLE
     *              (use the project treasury / multisig, NOT a hot wallet).
     * @param initialSupply Initial circulating supply minted to `admin` (in whole tokens).
     * @param maxSupplyCap Hard cap in whole tokens (e.g. 1_000_000_000 => 1B FLUX).
     */
    constructor(address admin, uint256 initialSupply, uint256 maxSupplyCap) ERC20("FluxCoin", "FLUX") ERC20Permit("FluxCoin") {
        require(admin != address(0), "FluxCoin: admin is zero address");
        require(maxSupplyCap >= initialSupply, "FluxCoin: cap < initial supply");

        maxSupply = maxSupplyCap * 10 ** decimals();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);

        if (initialSupply > 0) {
            _mint(admin, initialSupply * 10 ** decimals());
        }
    }

    /// @dev Explicit, immutable 18 decimals (standard for CEX/DEX compatibility).
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /**
     * @notice Mint tokens to a recipient. Callable only by MINTER_ROLE holders.
     * @dev The website backend calls this (or the FluxFaucet does inside `claim`)
     *      after it has verified the user's off-chain earned balance.
     */
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        require(to != address(0), "FluxCoin: mint to zero address");
        require(totalSupply() + amount <= maxSupply, "FluxCoin: max supply exceeded");
        _mint(to, amount);
        emit BackendMint(to, amount, "backend-mint");
    }

    /// @notice Convenience batch mint used by withdrawal dispatching pipelines.
    function mintBatch(address[] calldata recipients, uint256[] calldata amounts) external onlyRole(MINTER_ROLE) {
        require(recipients.length == amounts.length, "FluxCoin: length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            mint(recipients[i], amounts[i]);
        }
    }
}
