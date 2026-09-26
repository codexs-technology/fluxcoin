const { expect } = require('chai');
const hre = require('hardhat');
const { ethers } = hre;

const GELATO_FORWARDER = '0xd8253782c45a12053594b9deB72d8e8aB2Fca54c';

describe('FluxCoin + FluxFaucet (gasless withdrawal redemption)', function () {
  let admin, backend, user, relayer;
  let coin, faucet;
  const MAX_CLAIM = ethers.parseUnits('100000', 18);

  beforeEach(async () => {
    [admin, backend, user, relayer] = await ethers.getSigners();

    const FluxCoin = await ethers.getContractFactory('FluxCoin');
    coin = await FluxCoin.deploy(admin.address, 100000000n, 1000000000n);
    await coin.waitForDeployment();

    const FluxFaucet = await ethers.getContractFactory('FluxFaucet');
    faucet = await FluxFaucet.deploy(admin.address, await coin.getAddress(), GELATO_FORWARDER, MAX_CLAIM);
    await faucet.waitForDeployment();

    await coin.grantRole(await coin.MINTER_ROLE(), await faucet.getAddress());
    await coin.grantRole(await coin.MINTER_ROLE(), backend.address);
    // The backend signer key must hold SIGNER_ROLE to authorise withdrawals.
    await faucet.grantRole(await faucet.SIGNER_ROLE(), backend.address);
  });

  describe('FluxCoin (standard ERC-20 for CEX/DEX compatibility)', () => {
    it('exposes 18 decimals and the correct metadata', async () => {
      expect(await coin.decimals()).to.equal(18);
      expect(await coin.symbol()).to.equal('FLUX');
      expect(await coin.name()).to.equal('FluxCoin');
    });

    it('transfers the exact amount (no hidden transfer fee)', async () => {
      const amount = ethers.parseUnits('1000', 18);
      await coin.transfer(user.address, amount);
      expect(await coin.balanceOf(user.address)).to.equal(amount);
    });

    it('blocks minting from non MINTER_ROLE accounts', async () => {
      await expect(coin.connect(user).mint(user.address, 1n)).to.be.revertedWithCustomError(
        coin,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('enforces the immutable max supply', async () => {
      const cap = await coin.maxSupply();
      const supply = await coin.totalSupply();
      await expect(coin.connect(admin).mint(user.address, cap - supply + 1n)).to.be.revertedWith(
        'FluxCoin: max supply exceeded'
      );
    });
  });

  describe('FluxFaucet.claim', () => {
    const CHAIN_ID = 31337;

    async function signWithdrawal(signer, { verifyingContract, beneficiary, amount, nonce, deadline }) {
      return signer.signTypedData(
        { name: 'FluxCoinFaucet', version: '1', chainId: CHAIN_ID, verifyingContract },
        {
          Withdrawal: [
            { name: 'beneficiary', type: 'address' },
            { name: 'amount', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }
          ]
        },
        { beneficiary, amount, nonce, deadline }
      );
    }

    it('mints FLUX to the user when the backend signature is valid', async () => {
      const amount = ethers.parseUnits('2500', 18);
      const nonce = 1;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const signature = await signWithdrawal(backend, {
        verifyingContract: await faucet.getAddress(),
        beneficiary: user.address,
        amount,
        nonce,
        deadline
      });

      await expect(faucet.connect(user).claim(user.address, amount, nonce, deadline, signature))
        .to.emit(faucet, 'WithdrawalClaimed')
        .withArgs(user.address, amount, nonce, 'direct');

      expect(await coin.balanceOf(user.address)).to.equal(amount);
      expect(await faucet.totalClaimed()).to.equal(amount);
    });

    it('rejects a signature from a non SIGNER_ROLE account', async () => {
      const amount = ethers.parseUnits('100', 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const signature = await signWithdrawal(user, {
        verifyingContract: await faucet.getAddress(),
        beneficiary: user.address,
        amount,
        nonce: 1,
        deadline
      });

      await expect(faucet.connect(user).claim(user.address, amount, 1, deadline, signature)).to.be.revertedWith(
        'Faucet: invalid backend signature'
      );
    });

    it('rejects replayed nonces so a withdrawal cannot be submitted twice', async () => {
      const amount = ethers.parseUnits('100', 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const signature = await signWithdrawal(backend, {
        verifyingContract: await faucet.getAddress(),
        beneficiary: user.address,
        amount,
        nonce: 7,
        deadline
      });

      await faucet.connect(user).claim(user.address, amount, 7, deadline, signature);
      await expect(
        faucet.connect(user).claim(user.address, amount, 7, deadline, signature)
      ).to.be.revertedWith('Faucet: nonce already used');
    });

    it('rejects expired authorizations and amounts above the cap', async () => {
      const amount = ethers.parseUnits('100', 18);
      const past = BigInt(Math.floor(Date.now() / 1000) - 1);
      const expiredSig = await signWithdrawal(backend, {
        verifyingContract: await faucet.getAddress(),
        beneficiary: user.address,
        amount,
        nonce: 2,
        deadline: past
      });
      await expect(faucet.connect(user).claim(user.address, amount, 2, past, expiredSig)).to.be.revertedWith(
        'Faucet: authorization expired'
      );

      const bigAmount = MAX_CLAIM + 1n;
      const future = BigInt(Math.floor(Date.now() / 1000) + 900);
      const bigSig = await signWithdrawal(backend, {
        verifyingContract: await faucet.getAddress(),
        beneficiary: user.address,
        amount: bigAmount,
        nonce: 3,
        deadline: future
      });
      await expect(faucet.connect(user).claim(user.address, bigAmount, 3, future, bigSig)).to.be.revertedWith(
        'Faucet: amount above per-claim cap'
      );
    });

    it('cannot be claimed on behalf of somebody else', async () => {
      const amount = ethers.parseUnits('100', 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const signature = await signWithdrawal(backend, {
        verifyingContract: await faucet.getAddress(),
        beneficiary: user.address,
        amount,
        nonce: 4,
        deadline
      });

      await expect(
        faucet.connect(relayer).claim(user.address, amount, 4, deadline, signature)
      ).to.be.revertedWith('Faucet: beneficiary must be the claimer');
    });

    it('supports the ERC-2771 (Gelato Relay) gasless meta-transaction path', async () => {
      const Forwarder = await ethers.getContractFactory('MockTrustedForwarder');
      const forwarder = await Forwarder.deploy();
      await forwarder.waitForDeployment();

      const FluxFaucet = await ethers.getContractFactory('FluxFaucet');
      const relayedFaucet = await FluxFaucet.deploy(
        admin.address,
        await coin.getAddress(),
        await forwarder.getAddress(),
        MAX_CLAIM
      );
      await relayedFaucet.waitForDeployment();
      await coin.grantRole(await coin.MINTER_ROLE(), await relayedFaucet.getAddress());
      await relayedFaucet.grantRole(await relayedFaucet.SIGNER_ROLE(), backend.address);

      const amount = ethers.parseUnits('500', 18);
      const nonce = 1;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 900);
      const signature = await signWithdrawal(backend, {
        verifyingContract: await relayedFaucet.getAddress(),
        beneficiary: user.address,
        amount,
        nonce,
        deadline
      });

      const calldata = relayedFaucet.interface.encodeFunctionData('claim', [
        user.address,
        amount,
        nonce,
        deadline,
        signature
      ]);

      // The relayer pays the gas; `_msgSender()` inside the faucet is the user.
      await expect(forwarder.execute(await relayedFaucet.getAddress(), user.address, calldata))
        .to.emit(relayedFaucet, 'WithdrawalClaimed')
        .withArgs(user.address, amount, nonce, 'erc2771-relayed');

      expect(await coin.balanceOf(user.address)).to.equal(amount);
    });
  });
});
