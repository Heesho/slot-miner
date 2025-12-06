// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@pythnetwork/entropy-sdk-solidity/MockEntropy.sol";

contract TestMockEntropy is MockEntropy {
    constructor(address _defaultProvider) MockEntropy(_defaultProvider) {}
}
