import { readFile, writeFile } from "node:fs/promises";

const envText = await readFile(".env", "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
  const splitAt = line.indexOf("=");
  return [line.slice(0, splitAt), line.slice(splitAt + 1)];
}));
const rpcUrl = env.WIF_RPC_URL;
const tokenAddress = env.WIF_TOKEN_ADDRESS;
if (!rpcUrl || !/^https:\/\//i.test(rpcUrl)) throw new Error("WIF_RPC_URL must be HTTPS.");
if (!/^0x[0-9a-fA-F]{40}$/.test(tokenAddress || "")) throw new Error("WIF_TOKEN_ADDRESS is invalid.");

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`RPC ${JSON.stringify(body.error)}`);
  return body.result;
}

const base = { observedAt: new Date().toISOString(), rpcHost: new URL(rpcUrl).host, tokenAddress };
let result;
try {
  const chainHex = await rpc("eth_chainId");
  const chainId = Number(BigInt(chainHex));
  if (chainId !== 4663) throw new Error(`RPC reports chain ${chainId}; expected 4663.`);
  const code = await rpc("eth_getCode", [tokenAddress, "latest"]);
  if (code === "0x") throw new Error("Configured token address has no runtime bytecode.");
  const [decimalsHex, symbolHex] = await Promise.all([
    rpc("eth_call", [{ to: tokenAddress, data: "0x313ce567" }, "latest"]),
    rpc("eth_call", [{ to: tokenAddress, data: "0x95d89b41" }, "latest"]),
  ]);
  const symbolBytes = Buffer.from(symbolHex.slice(2), "hex");
  let symbol = "";
  if (symbolBytes.length === 32) symbol = symbolBytes.toString("utf8").replace(/\0+$/, "");
  else if (symbolBytes.length >= 64) {
    const offset = Number(BigInt(`0x${symbolBytes.subarray(0, 32).toString("hex")}`));
    const length = Number(BigInt(`0x${symbolBytes.subarray(offset, offset + 32).toString("hex")}`));
    symbol = symbolBytes.subarray(offset + 32, offset + 32 + length).toString("utf8");
  }
  result = { ...base, chainId, tokenCodeBytes: (code.length - 2) / 2, decimals: Number(BigInt(decimalsHex)), symbol };
} catch (error) {
  result = { ...base, error: String(error) };
}
await writeFile("evidence/rpc-probe.json", `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.error) process.exitCode = 1;
