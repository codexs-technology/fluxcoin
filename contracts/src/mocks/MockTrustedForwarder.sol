// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockTrustedForwarder
 * @notice TEST-ONLY stand-in for the Gelato Relay ERC-2771 trusted forwarder.
 *         It appends the real user address to the calldata so `_msgSender()`
 *         resolves to the user while the relayer pays the gas.
 *         Never deploy this on a public network.
 */
contract MockTrustedForwarder {
    event Forwarded(address indexed target, address indexed user);

    function execute(address target, address user, bytes calldata data) external returns (bytes memory) {
        emit Forwarded(target, user);
        (bool ok, bytes memory result) = target.call(abi.encodePacked(data, user));
        require(ok, "MockTrustedForwarder: call failed");
        return result;
    }
}
