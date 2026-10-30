// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../Daymark.sol";

interface VmDeployDaymark {
    function envAddress(string calldata key) external returns (address);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployDaymark {
    VmDeployDaymark private constant vm =
        VmDeployDaymark(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant EXPECTED_WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;

    function run() external returns (address deployed) {
        require(block.chainid == 4663, "wrong chain; mainnet only");
        address token = vm.envAddress("WIF_TOKEN_ADDRESS");
        require(token == EXPECTED_WIF, "token address differs from organizer-published WIF");
        vm.startBroadcast();
        Daymark app = new Daymark(token);
        vm.stopBroadcast();
        return address(app);
    }
}
