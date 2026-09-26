// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FlashToken
 * @notice Real transferable, swappable, and tradable ERC20 Flash Token with flash minting and fee mechanisms.
 */
contract FlashToken is ERC20, ERC20Permit, Ownable {
    uint256 public flashMintFee = 50; // 0.05% fee (50 basis points of 10,000)
    uint256 public constant MAX_FEE = 1000; // Max 10% fee (1000 basis points)
    mapping(address => bool) public authorizedMinters;

    event FlashMint(address indexed to, uint256 amount);
    event FlashFeeUpdated(uint256 newFee);
    event MinterAuthorized(address indexed minter);
    event MinterRevoked(address indexed minter);
    event TokensBurned(address indexed burner, uint256 amount);

    constructor(address initialOwner) 
        ERC20("FlashToken", "FLASH") 
        ERC20Permit("FlashToken")
        Ownable(initialOwner) 
    {
        authorizedMinters[initialOwner] = true;
        // Mint initial 1,000,000 FLASH tokens to deployer
        _mint(initialOwner, 1_000_000 * 10 ** decimals());
    }

    /**
     * @notice Flash mint tokens to a target recipient
     */
    function flashMint(address to, uint256 amount) external {
        require(authorizedMinters[msg.sender], "Not authorized to mint");
        _mint(to, amount);
        emit FlashMint(to, amount);
    }

    /**
     * @notice Transfer with dynamic protocol fee routed to token reserve/owner
     */
    function transfer(address to, uint256 amount) public override returns (bool) {
        uint256 fee = (amount * flashMintFee) / 10000;
        uint256 amountAfterFee = amount - fee;

        if (fee > 0) {
            _transfer(_msgSender(), owner(), fee);
        }

        return _transfer(_msgSender(), to, amountAfterFee);
    }

    /**
     * @notice Burn flash tokens from caller's balance
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
        emit TokensBurned(msg.sender, amount);
    }

    function setFlashMintFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE, "Fee too high");
        flashMintFee = newFee;
        emit FlashFeeUpdated(newFee);
    }

    function addAuthorizedMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = true;
        emit MinterAuthorized(minter);
    }

    function removeAuthorizedMinter(address minter) external onlyOwner {
        authorizedMinters[minter] = false;
        emit MinterRevoked(minter);
    }
}
