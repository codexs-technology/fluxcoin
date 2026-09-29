const { expect } = require('chai');
const { ethers } = require('hardhat');

/**
 * FlashToken — the per-asset ERC-20 (Flash USDT/BTC/ETH/TRX/SOL).
 *
 * Covers the properties the withdrawal pipeline relies on:
 *   - per-asset name/symbol/decimals are fixed at deployment
 *   - only MINTER_ROLE can mint, nobody else can
 *   - maxSupply is enforced in base units
 *   - transfer moves exactly the requested amount (no fee-on-transfer)
 */
describe('FlashToken', function () {
  async function deploy(decimals = 6, initialSupply = 0, maxSupply = 1_000_000n) {
    const [admin, minter, user] = await ethers.getSigners();
    const factory = await ethers.getContractFactory('FlashToken');
    const token = await factory.deploy('Flash USDT', 'USDT', decimals, admin.address, initialSupply, maxSupply);
    await token.waitForDeployment();
    return { token, admin, minter, user };
  }

  it('stores the per-asset metadata', async function () {
    const { token } = await deploy(6);
    expect(await token.name()).to.equal('Flash USDT');
    expect(await token.symbol()).to.equal('USDT');
    expect(await token.decimals()).to.equal(6);
  });

  it('supports the other asset precisions (BTC 8 / ETH 18 / SOL 9)', async function () {
    for (const decimals of [8, 18, 9]) {
      const { token } = await deploy(decimals);
      expect(await token.decimals()).to.equal(decimals);
    }
  });

  it('mints the initial supply to admin in base units', async function () {
    const { token, admin } = await deploy(6, 100n, 1_000_000n);
    expect(await token.balanceOf(admin.address)).to.equal(100n * 10n ** 6n);
  });

  it('lets only MINTER_ROLE mint', async function () {
    const { token, admin, minter, user } = await deploy(6);
    const MINTER_ROLE = await token.MINTER_ROLE();

    await expect(token.connect(user).mint(user.address, 5n * 10n ** 6n)).to.be.reverted;

    await token.connect(admin).grantRole(MINTER_ROLE, minter.address);
    await token.connect(minter).mint(user.address, 5n * 10n ** 6n);
    expect(await token.balanceOf(user.address)).to.equal(5n * 10n ** 6n);
  });

  it('enforces the immutable maxSupply', async function () {
    const { token, minter, user } = await deploy(6, 0n, 10n); // max 10 whole tokens
    const MINTER_ROLE = await token.MINTER_ROLE();
    const admin = await token.DEFAULT_ADMIN_ROLE();
    const owner = (await ethers.getSigners())[0];
    await token.connect(owner).grantRole(MINTER_ROLE, minter.address);

    await token.connect(minter).mint(user.address, 10n * 10n ** 6n);
    await expect(token.connect(minter).mint(user.address, 1n)).to.be.revertedWith('FlashToken: max supply exceeded');
    expect(admin).to.not.equal(ethers.ZeroAddress);
  });

  it('transfers exactly the requested amount (no fee-on-transfer)', async function () {
    const { token, admin, minter, user } = await deploy(6);
    const MINTER_ROLE = await token.MINTER_ROLE();
    await token.connect(admin).grantRole(MINTER_ROLE, minter.address);

    const amount = 12345n; // base units
    await token.connect(minter).mint(user.address, amount);
    const other = (await ethers.getSigners())[3];
    await token.connect(user).transfer(other.address, amount);
    expect(await token.balanceOf(other.address)).to.equal(amount);
    expect(await token.balanceOf(user.address)).to.equal(0n);
  });
});
