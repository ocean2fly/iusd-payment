import { expect } from "chai";
import { ethers } from "hardhat";
import {
  loadFixture,
  time,
} from "@nomicfoundation/hardhat-network-helpers";

describe("IPayRouter", function () {
  async function deployFixture() {
    const [owner, recipient, payer, other] = await ethers.getSigners();

    // Deploy a mock ERC20 token as iUSD
    const MockToken = await ethers.getContractFactory("MockERC20");
    const iUSD = await MockToken.deploy("iUSD Token", "iUSD", 6);
    await iUSD.waitForDeployment();

    // Deploy IPayRouter
    const IPayRouter = await ethers.getContractFactory("IPayRouter");
    const router = await IPayRouter.deploy(await iUSD.getAddress());
    await router.waitForDeployment();

    // Mint tokens to payer
    const mintAmount = ethers.parseUnits("10000", 6);
    await iUSD.mint(payer.address, mintAmount);

    return { router, iUSD, owner, recipient, payer, other, mintAmount };
  }

  describe("createPaymentRequest", function () {
    it("should create a payment request and emit PaymentCreated", async function () {
      const { router, recipient } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("INV-001");
      const expiresAt = (await time.latest()) + 3600;

      const tx = await router.createPaymentRequest(
        recipient.address,
        amount,
        reference,
        expiresAt
      );

      await expect(tx).to.emit(router, "PaymentCreated");
    });

    it("should revert with zero amount", async function () {
      const { router, recipient } = await loadFixture(deployFixture);
      const reference = ethers.encodeBytes32String("INV-002");
      const expiresAt = (await time.latest()) + 3600;

      await expect(
        router.createPaymentRequest(recipient.address, 0, reference, expiresAt)
      ).to.be.revertedWithCustomError(router, "InvalidAmount");
    });

    it("should revert with zero address recipient", async function () {
      const { router } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("INV-003");
      const expiresAt = (await time.latest()) + 3600;

      await expect(
        router.createPaymentRequest(
          ethers.ZeroAddress,
          amount,
          reference,
          expiresAt
        )
      ).to.be.revertedWithCustomError(router, "InvalidRecipient");
    });

    it("should revert with expired timestamp", async function () {
      const { router, recipient } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("INV-004");
      const expiresAt = (await time.latest()) - 1;

      await expect(
        router.createPaymentRequest(
          recipient.address,
          amount,
          reference,
          expiresAt
        )
      ).to.be.revertedWithCustomError(router, "InvalidExpiry");
    });
  });

  describe("pay", function () {
    it("should complete payment successfully", async function () {
      const { router, iUSD, recipient, payer } =
        await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("PAY-001");
      const expiresAt = (await time.latest()) + 3600;

      const tx = await router.createPaymentRequest(
        recipient.address,
        amount,
        reference,
        expiresAt
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      // Approve and pay
      await iUSD.connect(payer).approve(await router.getAddress(), amount);
      const payTx = await router.connect(payer).pay(paymentId);

      await expect(payTx)
        .to.emit(router, "PaymentCompleted")
        .withArgs(paymentId, payer.address, amount);

      // Verify recipient balance
      expect(await iUSD.balanceOf(recipient.address)).to.equal(amount);

      // Verify request is completed
      const request = await router.getPaymentRequest(paymentId);
      expect(request.completed).to.be.true;
      expect(request.payer).to.equal(payer.address);
    });

    it("should revert on double pay", async function () {
      const { router, iUSD, recipient, payer } =
        await loadFixture(deployFixture);
      const amount = ethers.parseUnits("50", 6);
      const reference = ethers.encodeBytes32String("PAY-002");
      const expiresAt = (await time.latest()) + 3600;

      const tx = await router.createPaymentRequest(
        recipient.address,
        amount,
        reference,
        expiresAt
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      // First payment
      await iUSD
        .connect(payer)
        .approve(await router.getAddress(), amount * 2n);
      await router.connect(payer).pay(paymentId);

      // Second payment should revert
      await expect(
        router.connect(payer).pay(paymentId)
      ).to.be.revertedWithCustomError(router, "PaymentAlreadyCompleted");
    });

    it("should revert on expired payment", async function () {
      const { router, iUSD, recipient, payer } =
        await loadFixture(deployFixture);
      const amount = ethers.parseUnits("50", 6);
      const reference = ethers.encodeBytes32String("PAY-003");
      const expiresAt = (await time.latest()) + 60;

      const tx = await router.createPaymentRequest(
        recipient.address,
        amount,
        reference,
        expiresAt
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      // Advance time past expiry
      await time.increase(120);

      await iUSD.connect(payer).approve(await router.getAddress(), amount);
      await expect(
        router.connect(payer).pay(paymentId)
      ).to.be.revertedWithCustomError(router, "PaymentExpired");
    });

    it("should revert on non-existent payment", async function () {
      const { router } = await loadFixture(deployFixture);
      const fakeId = ethers.encodeBytes32String("FAKE");

      await expect(
        router.pay(fakeId)
      ).to.be.revertedWithCustomError(router, "PaymentNotFound");
    });
  });

  describe("payDirect", function () {
    it("should transfer tokens directly with memo", async function () {
      const { router, iUSD, recipient, payer } =
        await loadFixture(deployFixture);
      const amount = ethers.parseUnits("200", 6);
      const memo = ethers.encodeBytes32String("coffee");

      await iUSD.connect(payer).approve(await router.getAddress(), amount);
      const tx = await router
        .connect(payer)
        .payDirect(recipient.address, amount, memo);

      await expect(tx)
        .to.emit(router, "DirectPayment")
        .withArgs(payer.address, recipient.address, amount, memo);

      expect(await iUSD.balanceOf(recipient.address)).to.equal(amount);
    });

    it("should revert with zero address", async function () {
      const { router, payer } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const memo = ethers.encodeBytes32String("test");

      await expect(
        router.connect(payer).payDirect(ethers.ZeroAddress, amount, memo)
      ).to.be.revertedWithCustomError(router, "InvalidRecipient");
    });

    it("should revert with zero amount", async function () {
      const { router, recipient, payer } = await loadFixture(deployFixture);
      const memo = ethers.encodeBytes32String("test");

      await expect(
        router.connect(payer).payDirect(recipient.address, 0, memo)
      ).to.be.revertedWithCustomError(router, "InvalidAmount");
    });
  });

  describe("cancelPaymentRequest", function () {
    it("should cancel a payment request", async function () {
      const { router, recipient, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("CANCEL-001");
      const expiresAt = (await time.latest()) + 3600;

      const tx = await router
        .connect(owner)
        .createPaymentRequest(recipient.address, amount, reference, expiresAt);
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      const cancelTx = await router.connect(owner).cancelPaymentRequest(paymentId);
      await expect(cancelTx)
        .to.emit(router, "PaymentCancelled")
        .withArgs(paymentId);

      const request = await router.getPaymentRequest(paymentId);
      expect(request.cancelled).to.be.true;
    });

    it("should revert when non-creator tries to cancel", async function () {
      const { router, recipient, owner, other } =
        await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("CANCEL-002");
      const expiresAt = (await time.latest()) + 3600;

      const tx = await router
        .connect(owner)
        .createPaymentRequest(recipient.address, amount, reference, expiresAt);
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      await expect(
        router.connect(other).cancelPaymentRequest(paymentId)
      ).to.be.revertedWithCustomError(router, "NotPaymentCreator");
    });

    it("should revert when cancelling already cancelled request", async function () {
      const { router, recipient, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("CANCEL-003");
      const expiresAt = (await time.latest()) + 3600;

      const tx = await router
        .connect(owner)
        .createPaymentRequest(recipient.address, amount, reference, expiresAt);
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      await router.connect(owner).cancelPaymentRequest(paymentId);

      await expect(
        router.connect(owner).cancelPaymentRequest(paymentId)
      ).to.be.revertedWithCustomError(router, "PaymentAlreadyCancelled");
    });

    it("should prevent paying a cancelled request", async function () {
      const { router, iUSD, recipient, payer, owner } =
        await loadFixture(deployFixture);
      const amount = ethers.parseUnits("100", 6);
      const reference = ethers.encodeBytes32String("CANCEL-004");
      const expiresAt = (await time.latest()) + 3600;

      const tx = await router
        .connect(owner)
        .createPaymentRequest(recipient.address, amount, reference, expiresAt);
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      await router.connect(owner).cancelPaymentRequest(paymentId);

      await iUSD.connect(payer).approve(await router.getAddress(), amount);
      await expect(
        router.connect(payer).pay(paymentId)
      ).to.be.revertedWithCustomError(router, "PaymentAlreadyCancelled");
    });
  });

  describe("getPaymentRequest", function () {
    it("should return correct payment request data", async function () {
      const { router, recipient } = await loadFixture(deployFixture);
      const amount = ethers.parseUnits("250", 6);
      const reference = ethers.encodeBytes32String("GET-001");
      const expiresAt = (await time.latest()) + 7200;

      const tx = await router.createPaymentRequest(
        recipient.address,
        amount,
        reference,
        expiresAt
      );
      const receipt = await tx.wait();
      const event = receipt!.logs.find((log) => {
        try {
          return router.interface.parseLog(log as any)?.name === "PaymentCreated";
        } catch {
          return false;
        }
      });
      const parsedEvent = router.interface.parseLog(event as any);
      const paymentId = parsedEvent!.args.paymentId;

      const request = await router.getPaymentRequest(paymentId);
      expect(request.recipient).to.equal(recipient.address);
      expect(request.amount).to.equal(amount);
      expect(request.ref).to.equal(reference);
      expect(request.completed).to.be.false;
      expect(request.cancelled).to.be.false;
      expect(request.payer).to.equal(ethers.ZeroAddress);
    });
  });
});
