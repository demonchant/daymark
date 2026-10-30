// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Daymark {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @notice Daily check-ins burn exactly one configured token and persist a UTC streak.
/// @dev Immutable token, no owner, no treasury, no upgrade path, no rewards.
contract Daymark {
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    IERC20Daymark public immutable wif;
    uint256 public immutable claimAmount;

    mapping(address account => uint256 day) public lastClaimDay;
    mapping(address account => uint256 count) private _streakCount;
    mapping(address account => uint256 count) public totalClaims;
    mapping(uint256 day => uint256 count) public dailyClaims;

    uint256 private _entered = 1;

    event CheckedIn(address indexed account, uint256 indexed utcDay, uint256 streak, uint256 amount);

    error InvalidToken();
    error AlreadyCheckedIn(uint256 utcDay);
    error TransferFailed();
    error ReentrantCall();

    function currentStreak(address account) public view returns (uint256) {
        if (totalClaims[account] == 0) return 0;
        uint256 today = block.timestamp / 1 days;
        uint256 previous = lastClaimDay[account];
        if (previous < today && today - previous > 1) return 0;
        return _streakCount[account];
    }

    constructor(address token) {
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        uint8 decimals = IERC20Daymark(token).decimals();
        if (decimals > 36) revert InvalidToken();
        wif = IERC20Daymark(token);
        claimAmount = 10 ** uint256(decimals);
    }

    function claim() external {
        if (_entered != 1) revert ReentrantCall();
        _entered = 2;

        uint256 today = block.timestamp / 1 days;
        uint256 previous = lastClaimDay[msg.sender];
        uint256 claimsBefore = totalClaims[msg.sender];
        if (claimsBefore != 0 && previous == today) revert AlreadyCheckedIn(today);

        // Update before the external call; any failure reverts the full transaction.
        lastClaimDay[msg.sender] = today;
        _streakCount[msg.sender] =
            claimsBefore != 0 && previous + 1 == today ? _streakCount[msg.sender] + 1 : 1;
        totalClaims[msg.sender] += 1;
        dailyClaims[today] += 1;

        uint256 balanceBefore = wif.balanceOf(BURN_ADDRESS);
        (bool ok, bytes memory result) = address(wif)
            .call(abi.encodeCall(IERC20Daymark.transferFrom, (msg.sender, BURN_ADDRESS, claimAmount)));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TransferFailed();
        uint256 balanceAfter = wif.balanceOf(BURN_ADDRESS);
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != claimAmount) {
            revert TransferFailed();
        }

        emit CheckedIn(msg.sender, today, _streakCount[msg.sender], claimAmount);
        _entered = 1;
    }
}
