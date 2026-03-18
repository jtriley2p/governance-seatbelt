// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.21;

error Unauthorized();

/**
 * @notice Tiny owner-gated fixture used to seed the synthetic 94-test -> 95-test Celo flow.
 * @dev The TypeScript fixture checks in the compiled runtime bytecode so normal sim runs do not
 * need a compile step, but this contract is the source of truth for that bytecode.
 */
contract TestOnlyOwnedTarget {
    address public owner;
    address public feeTo;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function setOwner(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setFeeToSetter(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        owner = newOwner;
    }

    function setFeeTo(address newFeeTo) external onlyOwner {
        feeTo = newFeeTo;
    }
}
