// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title FlashToken — one mintable ERC-20 per asset (USDT/BTC/ETH/TRX/SOL)
 *
 * The forge mints the asset the user selected, so EVERY asset gets its own
 * deployment of this contract with its native precision. The on-chain NAME is
 * the plain ticker — LOCKED decision: names are immutable after deploy:
 *
 *   USDT -> "USDT", 6 decimals
 *   BTC  -> "BTC",  8 decimals
 *   ETH  -> "ETH", 18 decimals
 *   TRX  -> "TRX",  6 decimals
 *   SOL  -> "SOL",  9 decimals
 *
 * Design rules (identical to FluxCoin):
 *   1. 100% standard ERC-20: no fee-on-transfer hook, so DEX routers and
 *      exchange deposits keep working.
 *   2. Minting is role-gated: only MINTER_ROLE holders (the Worker hot wallet
 *      `MINTER_PRIVATE_KEY`) can mint — users can never mint to themselves.
 *   3. `maxSupply` is immutable and enforced in base units, keeping the
 *      inflation schedule auditable.
 */
contract FlashToken is ERC20, ERC20Permit, ERC20Burnable, AccessControl {
    /// @notice Role required to mint new tokens (granted to the Worker minter).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    uint8 private immutable _tokenDecimals;

    /// @notice Hard cap on total supply in base units (whole tokens * 10^decimals).
    uint256 public immutable maxSupply;

    /// @notice Emitted on every backend mint for on-chain auditability.
    event BackendMint(address indexed to, uint256 amount, string reason);

    /**
     * @param name_       Token name, e.g. "USDT" (plain ticker — immutable after deploy).
     * @param symbol_     Token symbol, e.g. "USDT".
     * @param decimals_   Asset precision (6/8/18/6/9 for the five presets).
     * @param admin       Receives DEFAULT_ADMIN_ROLE + MINTER_ROLE (treasury/multisig).
     * @param initialSupply Initial supply minted to `admin` in WHOLE tokens (0 for mint-on-demand).
     * @param maxSupplyCap Hard cap in WHOLE tokens.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        address admin,
        uint256 initialSupply,
        uint256 maxSupplyCap
    ) ERC20(name_, symbol_) ERC20Permit(name_) {
        require(admin != address(0), "FlashToken: admin is zero address");
        require(decimals_ > 0 && decimals_ <= 18, "FlashToken: bad decimals");
        require(maxSupplyCap >= initialSupply, "FlashToken: cap < initial supply");

        _tokenDecimals = decimals_;
        maxSupply = maxSupplyCap * 10 ** uint256(decimals_);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);

        if (initialSupply > 0) {
            _mint(admin, initialSupply * 10 ** uint256(decimals_));
        }
    }

    /// @notice Per-asset precision, fixed at deployment (USDT 6, BTC 8, ETH 18, TRX 6, SOL 9).
    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    /**
     * @notice Mints to a recipient. Only MINTER_ROLE (the Worker hot wallet) can call.
     * @dev The API calls this after it verified the user's off-chain earned balance.
     */
    function mint(address to, uint256 amount) public onlyRole(MINTER_ROLE) {
        require(to != address(0), "FlashToken: mint to zero address");
        require(totalSupply() + amount <= maxSupply, "FlashToken: max supply exceeded");
        _mint(to, amount);
        emit BackendMint(to, amount, "backend-mint");
    }

    /// @notice Convenience batch mint (kept for pipelines; the API mints one tx at a time).
    function mintBatch(address[] calldata recipients, uint256[] calldata amounts) external onlyRole(MINTER_ROLE) {
        require(recipients.length == amounts.length, "FlashToken: length mismatch");
        for (uint256 i = 0; i < recipients.length; i++) {
            mint(recipients[i], amounts[i]);
        }
    }
}
