import { BrowserProvider, Contract, JsonRpcProvider, getAddress, isAddress, keccak256, parseUnits } from "ethers";
import { config, configProblems } from "./config.js";

const TOKEN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
];
const DAYMARK_ABI = [
  "function claim()",
  "function lastClaimDay(address) view returns (uint256)",
  "function currentStreak(address) view returns (uint256)",
  "function totalClaims(address) view returns (uint256)",
  "function dailyClaims(uint256) view returns (uint256)",
  "function claimAmount() view returns (uint256)",
  "function wif() view returns (address)",
  "event CheckedIn(address indexed account,uint256 indexed utcDay,uint256 streak,uint256 amount)",
];

let readProvider;
let tokenRead;
let appRead;

export function getReadContracts() {
  const problems = configProblems();
  if (problems.length) throw new Error(problems.join(" "));
  if (!readProvider) {
    // Do not trust the configured chain ID as proof of the RPC's actual chain.
    readProvider = new JsonRpcProvider(config.rpcUrl);
    tokenRead = new Contract(getAddress(config.tokenAddress), TOKEN_ABI, readProvider);
    appRead = new Contract(getAddress(config.contractAddress), DAYMARK_ABI, readProvider);
  }
  return { provider: readProvider, token: tokenRead, app: appRead };
}

export async function verifyDeployment() {
  const { provider, token, app } = getReadContracts();
  const [network, tokenCode, appCode, decimals, boundToken] = await Promise.all([
    provider.getNetwork(),
    provider.getCode(config.tokenAddress),
    provider.getCode(config.contractAddress),
    token.decimals(),
    app.wif(),
  ]);
  if (Number(network.chainId) !== 4663) throw new Error(`RPC reports chain ${network.chainId}; expected 4663.`);
  if (tokenCode === "0x" || appCode === "0x") throw new Error("Configured WIF or Daymark address has no contract bytecode on this chain.");
  if (keccak256(tokenCode).toLowerCase() !== config.tokenCodeHash.toLowerCase()) throw new Error("WIF runtime bytecode hash does not match the independently verified configuration.");
  if (keccak256(appCode).toLowerCase() !== config.contractCodeHash.toLowerCase()) throw new Error("Daymark runtime bytecode hash does not match the reviewed deployment configuration.");
  if (getAddress(boundToken) !== getAddress(config.tokenAddress)) throw new Error("Daymark contract is bound to a different WIF token address.");
  if (Number(decimals) < 0 || Number(decimals) > 36) throw new Error("WIF decimals are outside the supported safe range.");
  return { decimals: Number(decimals), tokenCode, appCode };
}

export async function readAccount(account) {
  if (!isAddress(account)) throw new Error("Wallet returned an invalid account address.");
  const { provider, token, app } = getReadContracts();
  const block = await provider.getBlock("latest");
  if (!block) throw new Error("RPC did not return the latest Robinhood Chain block.");
  const chainDay = Math.floor(block.timestamp / 86_400);
  const atBlock = { blockTag: block.number };
  const [decimals, balance, amount, lastDay, streak, totalClaims, todayClaims] = await Promise.all([
    token.decimals(atBlock), token.balanceOf(account, atBlock), app.claimAmount(atBlock), app.lastClaimDay(account, atBlock),
    app.currentStreak(account, atBlock), app.totalClaims(account, atBlock), app.dailyClaims(chainDay, atBlock),
  ]);
  return {
    decimals: Number(decimals), balance,
    amount,
    blockNumber: block.number, chainDay, lastDay: Number(lastDay), streak,
    totalClaims, todayClaims,
  };
}

export async function connectAccount() {
  if (!window.ethereum?.request) throw new Error("No EVM wallet was detected. Install or unlock a browser wallet, then reload.");
  const chain = await window.ethereum.request({ method: "eth_chainId" });
  const chainId = Number(BigInt(chain));
  if (chainId !== 4663) throw new Error(`Wallet is on chain ${chainId}; switch it manually to Robinhood Chain (4663). No network switch was requested.`);
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  if (!accounts?.[0]) throw new Error("Wallet did not return an account.");
  return getAddress(accounts[0]);
}

export async function submitDailyClaim(account, callbacks) {
  if (!window.ethereum?.request) throw new Error("No EVM wallet is available.");
  const chain = Number(BigInt(await window.ethereum.request({ method: "eth_chainId" })));
  if (chain !== 4663) throw new Error(`Wallet is on chain ${chain}; expected 4663. Switch networks manually.`);
  const { token, app } = getReadContracts();
  const deployment = await verifyDeployment();
  const state = await readAccount(account);
  const exactAmount = parseUnits("1", deployment.decimals);
  if (state.amount !== exactAmount) throw new Error(`Configured contract claim amount is ${state.amount.toString()}, expected exactly 1 WIF (${exactAmount.toString()} base units).`);
  if (state.balance < exactAmount) throw new Error("Wallet balance is below the exact 1 WIF daily claim amount.");
  if (state.lastDay === state.chainDay) throw new Error("This wallet already checked in for the current chain UTC day.");
  const wallet = new BrowserProvider(window.ethereum, 4663);
  const signer = await wallet.getSigner(account);
  const tokenWrite = token.connect(signer);
  const allowance = await token.allowance(account, config.contractAddress);
  if (allowance > exactAmount) throw new Error("Existing WIF allowance is greater than 1 WIF. Revoke or reduce it in your wallet before claiming; Daymark will not use excess approval.");
  if (allowance < exactAmount) {
    callbacks.onStage("Authorize exactly 1 WIF for this claim. Review the wallet prompt.");
    const approval = await tokenWrite.approve(config.contractAddress, exactAmount);
    callbacks.onHash(approval.hash);
    const approvalReceipt = await approval.wait(1);
    if (!approvalReceipt || approvalReceipt.status !== 1) throw new Error("WIF approval failed or was not included in a successful chain block.");
    const allowanceAfter = await token.allowance(account, config.contractAddress);
    if (allowanceAfter < exactAmount) throw new Error("Approval receipt succeeded, but independent allowance read-back is below 1 WIF.");
  }

  callbacks.onStage("Send the daily claim. It permanently burns exactly 1 WIF if confirmed.");
  const tx = await app.connect(signer).claim();
  callbacks.onHash(tx.hash);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("Claim transaction failed or was not included in a successful chain block.");
  const event = receipt.logs.map((log) => { try { return app.interface.parseLog(log); } catch { return null; } })
    .find((parsed) => parsed?.name === "CheckedIn" && parsed.args.account.toLowerCase() === account.toLowerCase());
  if (!event || event.args.amount !== exactAmount) throw new Error("Claim read-back changed, but the receipt lacks the expected CheckedIn event and exact amount.");
  const transfer = receipt.logs
    .filter((log) => log.address.toLowerCase() === config.tokenAddress.toLowerCase())
    .map((log) => { try { return token.interface.parseLog(log); } catch { return null; } })
    .find((parsed) => parsed?.name === "Transfer"
      && parsed.args.from.toLowerCase() === account.toLowerCase()
      && parsed.args.to.toLowerCase() === "0x000000000000000000000000000000000000dead"
      && parsed.args.value === exactAmount);
  if (!transfer) throw new Error("Claim receipt lacks the exact 1 WIF transfer from this wallet to the burn address.");
  const postState = await readAccount(account);
  if (postState.lastDay !== Number(event.args.utcDay) || postState.totalClaims !== state.totalClaims + 1n) {
    throw new Error("Transaction receipt exists, but independent contract read-back did not confirm the expected claim state.");
  }
  return { receipt, postState, hash: tx.hash, event };
}

export function explorerTxUrl(hash) {
  return `${config.explorerUrl.replace(/\/$/, "")}/tx/${hash}`;
}

export function explorerAddressUrl(address) {
  return `${config.explorerUrl.replace(/\/$/, "")}/address/${address}`;
}
