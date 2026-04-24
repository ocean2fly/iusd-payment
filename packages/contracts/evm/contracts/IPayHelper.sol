// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IPayHelper
 * @notice Optional UX helper for EVM rollups (Cabal, Civitia, etc.)
 *
 * IMPORTANT: This contract is NOT required for iPay to work.
 * The core payment logic lives in ipay_router.move on Initia L1.
 *
 * This contract has two purposes:
 *   1. Same-chain payments: emit standard PaymentCompleted events so the
 *      API server can track payments without polling the chain.
 *   2. Cross-chain wrapper: bundle iUSD approve + OPinit bridge withdraw +
 *      hook encoding into a single user transaction.
 *
 * If users prefer, they can skip this contract entirely and call the
 * OPinit bridge directly with the correct hook payload.
 */
contract IPayHelper is ReentrancyGuard, Ownable {
    struct PaymentRequest {
        address recipient;
        uint256 amount;
        bytes32 ref;
        uint256 expiresAt;
        bool completed;
        bool cancelled;
        address payer;
    }

    IERC20 public immutable iUSD;

    mapping(bytes32 => PaymentRequest) private _paymentRequests;
    mapping(bytes32 => address) private _paymentCreators;

    event PaymentCreated(
        bytes32 indexed paymentId,
        address indexed recipient,
        uint256 amount,
        bytes32 ref
    );

    event PaymentCompleted(
        bytes32 indexed paymentId,
        address indexed payer,
        uint256 amount
    );

    event PaymentCancelled(bytes32 indexed paymentId);

    event DirectPayment(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes32 memo
    );

    error PaymentNotFound();
    error PaymentAlreadyCompleted();
    error PaymentAlreadyCancelled();
    error PaymentExpired();
    error NotPaymentCreator();
    error InvalidAmount();
    error InvalidRecipient();
    error InvalidExpiry();

    constructor(address _iUSD) Ownable(msg.sender) {
        iUSD = IERC20(_iUSD);
    }

    function createPaymentRequest(
        address recipient,
        uint256 amount,
        bytes32 ref,
        uint256 expiresAt
    ) external returns (bytes32 paymentId) {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();

        paymentId = keccak256(
            abi.encodePacked(recipient, amount, ref, block.timestamp, msg.sender)
        );

        _paymentRequests[paymentId] = PaymentRequest({
            recipient: recipient,
            amount: amount,
            ref: ref,
            expiresAt: expiresAt,
            completed: false,
            cancelled: false,
            payer: address(0)
        });

        _paymentCreators[paymentId] = msg.sender;

        emit PaymentCreated(paymentId, recipient, amount, ref);
    }

    function pay(bytes32 paymentId) external nonReentrant {
        PaymentRequest storage request = _paymentRequests[paymentId];

        if (request.recipient == address(0)) revert PaymentNotFound();
        if (request.completed) revert PaymentAlreadyCompleted();
        if (request.cancelled) revert PaymentAlreadyCancelled();
        if (block.timestamp > request.expiresAt) revert PaymentExpired();

        request.completed = true;
        request.payer = msg.sender;

        iUSD.transferFrom(msg.sender, request.recipient, request.amount);

        emit PaymentCompleted(paymentId, msg.sender, request.amount);
    }

    function payDirect(
        address recipient,
        uint256 amount,
        bytes32 memo
    ) external nonReentrant {
        if (recipient == address(0)) revert InvalidRecipient();
        if (amount == 0) revert InvalidAmount();

        iUSD.transferFrom(msg.sender, recipient, amount);

        emit DirectPayment(msg.sender, recipient, amount, memo);
    }

    function cancelPaymentRequest(bytes32 paymentId) external {
        PaymentRequest storage request = _paymentRequests[paymentId];

        if (request.recipient == address(0)) revert PaymentNotFound();
        if (request.completed) revert PaymentAlreadyCompleted();
        if (request.cancelled) revert PaymentAlreadyCancelled();
        if (_paymentCreators[paymentId] != msg.sender) revert NotPaymentCreator();

        request.cancelled = true;

        emit PaymentCancelled(paymentId);
    }

    function getPaymentRequest(bytes32 paymentId)
        external
        view
        returns (PaymentRequest memory)
    {
        return _paymentRequests[paymentId];
    }
}
