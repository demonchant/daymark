import { writeFile } from "node:fs/promises";

const [tokenAddress, appAddress] = process.argv.slice(2);
const rpcUrl = process.env.WIF_RPC_URL;
if (!rpcUrl || !/^https:\/\//i.test(rpcUrl)) throw new Error("Set WIF_RPC_URL to an HTTPS Robinhood Chain RPC endpoint.");
if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress || "")) throw new Error("Usage: node scripts/inspect-chain.mjs <WIF-token-address> [Daymark-address]");
if (appAddress && !/^0x[0-9a-fA-F]{40}$/.test(appAddress)) throw new Error("Daymark address must be a valid 20-byte EVM address.");

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${JSON.stringify(body.error)}`);
  return body.result;
}

function decodeSymbol(encoded) {
  const bytes = Buffer.from(encoded.slice(2), "hex");
  if (bytes.length === 32) return bytes.toString("utf8").replace(/\0+$/, "");
  if (bytes.length >= 64) {
    const offset = Number(BigInt(`0x${bytes.subarray(0, 32).toString("hex")}`));
    const length = Number(BigInt(`0x${bytes.subarray(offset, offset + 32).toString("hex")}`));
    return bytes.subarray(offset + 32, offset + 32 + length).toString("utf8");
  }
  throw new Error("Token symbol() returned an invalid ABI value.");
}

async function inspect(address) {
  const code = await rpc("eth_getCode", [address, "latest"]);
  if (code === "0x") throw new Error(`No contract bytecode exists at ${address} on chain 4663.`);
  // web3_sha3 is the RPC's Keccak-256 primitive, matching Ethereum runtime code hash semantics.
  const runtimeCodeHash = await rpc("web3_sha3", [code]);
  return { address, runtimeBytes: (code.length - 2) / 2, runtimeCodeHash };
}

const chainId = Number(BigInt(await rpc("eth_chainId")));
if (chainId !== 4663) throw new Error(`RPC reports chain ${chainId}; expected 4663. No other network is accepted.`);
const tokenInfo = await inspect(tokenAddress);
const [decimalsHex, symbolHex] = await Promise.all([
  rpc("eth_call", [{ to: tokenAddress, data: "0x313ce567" }, "latest"]),
  rpc("eth_call", [{ to: tokenAddress, data: "0x95d89b41" }, "latest"]),
]);
const decimals = Number(BigInt(decimalsHex));
if (decimals > 36) throw new Error(`Token decimals ${decimals} are outside the supported range.`);
const result = {
  observedAt: new Date().toISOString(),
  rpcHost: new URL(rpcUrl).host,
  chainId,
  token: { ...tokenInfo, decimals, symbol: decodeSymbol(symbolHex) },
};

if (appAddress) {
  const appInfo = await inspect(appAddress);
  const [wifSelector, amountSelector] = await Promise.all([
    rpc("web3_sha3", [`0x${Buffer.from("wif()", "utf8").toString("hex")}`]),
    rpc("web3_sha3", [`0x${Buffer.from("claimAmount()", "utf8").toString("hex")}`]),
  ]);
  const [boundTokenHex, claimAmountHex] = await Promise.all([
    rpc("eth_call", [{ to: appAddress, data: wifSelector.slice(0, 10) }, "latest"]),
    rpc("eth_call", [{ to: appAddress, data: amountSelector.slice(0, 10) }, "latest"]),
  ]);
  const expectedAmount = 10n ** BigInt(decimals);
  const boundToken = `0x${boundTokenHex.slice(-40)}`;
  const claimAmount = BigInt(claimAmountHex);
  if (boundToken.toLowerCase() !== tokenAddress.toLowerCase()) throw new Error("Daymark is bound to a token address different from the inspected WIF token.");
  if (claimAmount !== expectedAmount) throw new Error(`Daymark claim amount ${claimAmount} does not equal exactly one ${result.token.symbol} (${expectedAmount} base units).`);
  result.daymark = { ...appInfo, boundToken, claimAmount: claimAmount.toString() };
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
