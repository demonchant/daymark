// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../Daymark.sol";

interface VmDaymark {
    function warp(uint256 timestamp) external;
}

/// @dev Test-only ERC-20 fixture. It is never imported by the product contract or frontend.
contract MockWIF is IERC20Daymark {
    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint8 public immutable override decimals;
    bool public chargeFee;
    Daymark private _reentryTarget;
    bool private _attemptReentry;
    bool public reentryBlocked;

    constructor(uint8 tokenDecimals) {
        decimals = tokenDecimals;
    }

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function setChargeFee(bool value) external {
        chargeFee = value;
    }

    function setReentry(Daymark target, bool enabled) external {
        _reentryTarget = target;
        _attemptReentry = enabled;
        reentryBlocked = false;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        if (_attemptReentry) {
            (bool success,) = address(_reentryTarget).call(abi.encodeCall(Daymark.claim, ()));
            require(!success, "reentrant claim succeeded");
            reentryBlocked = true;
        }
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += chargeFee ? amount - 1 : amount;
        return true;
    }
}

contract DaymarkTest {
    VmDaymark private constant vm = VmDaymark(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
    MockWIF private token;
    Daymark private daymark;

    function setUp() public {
        token = new MockWIF(18);
        token.mint(address(this), 5 ether);
        daymark = new Daymark(address(token));
        token.approve(address(daymark), 5 ether);
    }

    function testClaimTransfersOneTokenAndRecordsState() public {
        daymark.claim();
        uint256 today = block.timestamp / 1 days;
        require(token.balanceOf(DEAD) == 1 ether, "not exactly one token");
        require(daymark.lastClaimDay(address(this)) == today, "wrong day");
        require(daymark.currentStreak(address(this)) == 1, "wrong initial streak");
        require(daymark.totalClaims(address(this)) == 1, "wrong total");
        require(daymark.dailyClaims(today) == 1, "wrong daily total");
    }

    function testSecondClaimOnSameDayRevertsWithoutStateChange() public {
        daymark.claim();
        (bool ok,) = address(daymark).call(abi.encodeCall(Daymark.claim, ()));
        require(!ok, "duplicate claim succeeded");
        require(daymark.totalClaims(address(this)) == 1, "duplicate changed total");
        require(token.balanceOf(DEAD) == 1 ether, "duplicate transferred tokens");
    }

    function testReentrantTokenCallbackCannotClaimAgain() public {
        token.setReentry(daymark, true);
        daymark.claim();
        require(token.reentryBlocked(), "reentrant claim was not blocked");
        require(daymark.totalClaims(address(this)) == 1, "reentrant call changed claim count");
        require(token.balanceOf(DEAD) == 1 ether, "reentrant call transferred extra tokens");
    }

    function testConsecutiveUtcDaysExtendStreak() public {
        daymark.claim();
        vm.warp((block.timestamp / 1 days + 1) * 1 days + 1);
        daymark.claim();
        require(daymark.currentStreak(address(this)) == 2, "consecutive claim did not extend streak");
        require(daymark.totalClaims(address(this)) == 2, "wrong total after second day");
    }

    function testMissedUtcDayRestartsStreak() public {
        daymark.claim();
        vm.warp((block.timestamp / 1 days + 2) * 1 days + 1);
        require(daymark.currentStreak(address(this)) == 0, "missed streak still active");
        daymark.claim();
        require(daymark.currentStreak(address(this)) == 1, "missed day did not reset streak");
        require(daymark.totalClaims(address(this)) == 2, "missed-day claim not recorded");
    }

    function testFeeOnTransferTokenRevertsAllState() public {
        token.setChargeFee(true);
        (bool ok,) = address(daymark).call(abi.encodeCall(Daymark.claim, ()));
        require(!ok, "fee-on-transfer token accepted");
        require(daymark.totalClaims(address(this)) == 0, "failed claim changed total");
        require(token.balanceOf(DEAD) == 0, "failed claim retained transfer");
    }

    function testInsufficientAllowanceRevertsAllState() public {
        token.approve(address(daymark), 0);
        (bool ok,) = address(daymark).call(abi.encodeCall(Daymark.claim, ()));
        require(!ok, "claim without allowance succeeded");
        require(daymark.totalClaims(address(this)) == 0, "failed claim changed total");
    }

    function testConstructorRejectsAddressWithoutTokenCode() public {
        try new Daymark(address(1)) returns (Daymark) {
            revert("accepted address without token code");
        } catch { }
    }
}
