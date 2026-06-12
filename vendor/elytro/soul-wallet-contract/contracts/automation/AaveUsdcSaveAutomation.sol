pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IAaveV3 {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
}

/**
 * @title AaveUsdcSaveAutomation
 * @dev This contract allows a bot to deposit USDC to Aave on behalf of a user.
 */
contract AaveUsdcSaveAutomation is Ownable {
    using SafeERC20 for IERC20;

    event BotAdded(address bot);
    event BotRemoved(address bot);
    event UsdcDepositedToAave(address user, uint256 amount);

    IERC20 immutable usdcToken;
    IAaveV3 immutable aave;
    mapping(address => bool) public bots;

    /**
     * @dev Modifier to make a function callable only by a bot.
     */
    modifier onlyBot() {
        require(bots[msg.sender], "no permission");
        _;
    }

    constructor(address _owner, address _usdcAddr, address _aaveUsdcPoolAddr) Ownable(_owner) {
        usdcToken = IERC20(_usdcAddr);
        aave = IAaveV3(_aaveUsdcPoolAddr);
        usdcToken.approve(address(aave), 2 ** 256 - 1);
    }

    /**
     * @notice Deposits USDC to Aave on behalf of a user
     * @dev This function can only be called by a bot
     * @param _user The address of the user for whom to deposit USDC
     * @param amount The amount of USDC to deposit
     */
    function depositUsdcToAave(address _user, uint256 amount) public onlyBot {
        usdcToken.safeTransferFrom(_user, address(this), amount);
        aave.supply(address(usdcToken), amount, _user, 0);
        emit UsdcDepositedToAave(_user, amount);
    }

    /**
     * @notice Deposits USDC to Aave on behalf of multiple users
     * @dev This function can only be called by a bot
     * @param _users An array of addresses of the users for whom to deposit USDC
     * @param amounts An array of amounts of USDC to deposit for each user
     */
    function depositUsdcToAaveBatch(address[] calldata _users, uint256[] calldata amounts) public onlyBot {
        require(_users.length == amounts.length, "invalid input");
        for (uint256 i = 0; i < _users.length; i++) {
            depositUsdcToAave(_users[i], amounts[i]);
        }
    }

    function addBot(address bot) public onlyOwner {
        bots[bot] = true;
        emit BotAdded(bot);
    }

    function removeBot(address bot) public onlyOwner {
        bots[bot] = false;
        emit BotRemoved(bot);
    }
}
