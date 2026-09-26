// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {ERC2771Context} from "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import {IFluxCoin} from "./interfaces/IFluxCoin.sol";

/**
 * @title FluxFaucet
 * @notice Redeems a user's OFF-CHAIN (site) balance into real FLUX tokens.
 *
 *  WHY THIS CONTRACT EXISTS (zero-fee / gasless withdrawals)
 *  --------------------------------------------------------
 *  The website ledger is authoritative for "earned coins". When a user withdraws:
 *
 *   1. The backend validates the site balance server-side and signs an EIP-712
 *      `Withdrawal` struct with its SIGNER_ROLE key.
 *   2. The user (or a gas relayer) submits `claim(...)` with that signature.
 *   3. The contract verifies the signature, consumes the nonce (replay protection)
 *      and mints the FLUX tokens straight to the user's wallet.
 *
 *  Gas is NEVER paid by the user in either supported mode:
 *   - ERC-4337: the user's smart account sends the UserOperation and a Paymaster
 *     (Biconomy/Gelato) sponsors it -> `_msgSender()` is the smart account itself.
 *   - ERC-2771 meta-tx: the user signs the meta-transaction and the Gelato Relay
 *     executor submits it -> `_msgSender()` is unwrapped from the trusted forwarder.
 */
contract FluxFaucet is EIP712, ERC2771Context, AccessControl {
    /// @notice Role allowed to sign off-chain withdrawal authorizations (backend signer).
    bytes32 public constant SIGNER_ROLE = keccak256("SIGNER_ROLE");
    /// @notice Role allowed to tune per-claim limits.
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");

    bytes32 public constant WITHDRAWAL_TYPEHASH =
        keccak256("Withdrawal(address beneficiary,uint256 amount,uint256 nonce,uint256 deadline)");

    IFluxCoin public immutable coin;

    /// @notice Highest consumed nonce per beneficiary (monotonic => strict replay protection).
    mapping(address => uint256) public nonceOf;

    /// @notice Maximum amount redeemable in a single claim (18-decimal base units).
    uint256 public maxClaimAmount;

    /// @notice Total FLUX minted through this faucet (accounting for the backend).
    uint256 public totalClaimed;

    event WithdrawalClaimed(address indexed beneficiary, uint256 amount, uint256 nonce, string method);
    event MaxClaimAmountUpdated(uint256 previousAmount, uint256 newAmount);

    /**
     * @param admin Treasury/multisig holding DEFAULT_ADMIN_ROLE + SIGNER_ROLE + CONFIG_ROLE.
     * @param coin_ Address of the deployed FluxCoin (this contract needs MINTER_ROLE on it).
     * @param trustedForwarder ERC-2771 forwarder address:
     *        - Gelato Relay: 0xd8253782c45a12053594b9deB72d8e8aB2Fca54c
     *        - Hardhat/local: 0x0 when using pure ERC-4337 (Biconomy) only.
     * @param initialMaxClaimAmount Per-claim cap in base units (18 decimals).
     */
    constructor(
        address admin,
        address coin_,
        address trustedForwarder,
        uint256 initialMaxClaimAmount
    ) EIP712("FluxCoinFaucet", "1") ERC2771Context(trustedForwarder) {
        require(admin != address(0), "Faucet: admin is zero address");
        require(coin_ != address(0), "Faucet: coin is zero address");

        coin = IFluxCoin(coin_);
        maxClaimAmount = initialMaxClaimAmount;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SIGNER_ROLE, admin);
        _grantRole(CONFIG_ROLE, admin);
    }

    /**
     * @notice Redeem a backend-signed withdrawal authorization.
     * @param beneficiary Wallet that receives the minted FLUX (must be the caller).
     * @param amount Amount in 18-decimal base units (backend validated <= site balance).
     * @param nonce Monotonic nonce issued by the backend for this beneficiary.
     * @param deadline Unix timestamp after which the authorization expires.
     * @param signature Backend EIP-712 signature (65-byte ECDSA).
     */
    function claim(
        address beneficiary,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        address claimer = _msgSender();

        require(block.timestamp <= deadline, "Faucet: authorization expired");
        require(beneficiary == claimer, "Faucet: beneficiary must be the claimer");
        require(amount > 0, "Faucet: amount is zero");
        require(amount <= maxClaimAmount, "Faucet: amount above per-claim cap");
        require(nonce > nonceOf[beneficiary], "Faucet: nonce already used");

        bytes32 digest = claimDigest(beneficiary, amount, nonce, deadline);
        address signer = ECDSA.recover(digest, signature);
        require(hasRole(SIGNER_ROLE, signer), "Faucet: invalid backend signature");

        nonceOf[beneficiary] = nonce;
        totalClaimed += amount;

        coin.mint(beneficiary, amount);

        emit WithdrawalClaimed(beneficiary, amount, nonce, msg.sender == trustedForwarder() ? "erc2771-relayed" : "direct");
    }

    /// @notice EIP-712 digest the backend must sign (exposed for backend + tests).
    function claimDigest(
        address beneficiary,
        uint256 amount,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(abi.encode(WITHDRAWAL_TYPEHASH, beneficiary, amount, nonce, deadline))
            );
    }

    /// @notice Helper so the backend can print the EIP-712 domain it signs against.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function setMaxClaimAmount(uint256 newMax) external onlyRole(CONFIG_ROLE) {
        emit MaxClaimAmountUpdated(maxClaimAmount, newMax);
        maxClaimAmount = newMax;
    }

    // --- ERC-2771 + AccessControl multiple-inheritance resolution ---
    // Both ERC2771Context and Context (via AccessControl) declare these hooks, so a
    // diamond override listing both parents is required by Solidity.
    // (OpenZeppelin 5.x: AccessControl no longer declares them itself.)

    function _msgSender() internal view override(ERC2771Context, Context) returns (address) {
        return ERC2771Context._msgSender();
    }

    function _msgData() internal view override(ERC2771Context, Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength() internal view override(ERC2771Context, Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }
}
