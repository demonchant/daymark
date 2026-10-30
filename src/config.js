const chainId = Number(import.meta.env.VITE_CHAIN_ID || "0");

export const config = {
  chainId,
  rpcUrl: import.meta.env.VITE_RPC_URL?.trim() || "",
  tokenAddress: import.meta.env.VITE_WIF_ADDRESS?.trim() || "",
  tokenCodeHash: import.meta.env.VITE_WIF_CODE_HASH?.trim() || "",
  contractAddress: import.meta.env.VITE_DAYMARK_ADDRESS?.trim() || "",
  contractCodeHash: import.meta.env.VITE_DAYMARK_CODE_HASH?.trim() || "",
  explorerUrl: import.meta.env.VITE_EXPLORER_URL?.trim() || "",
};

export function configProblems() {
  const problems = [];
  if (config.chainId !== 4663) problems.push("Set VITE_CHAIN_ID=4663 (Robinhood Chain mainnet); the app does not select a network implicitly.");
  if (!/^https:\/\//i.test(config.rpcUrl)) problems.push("Set VITE_RPC_URL to an HTTPS Robinhood Chain mainnet RPC endpoint.");
  for (const [name, value] of [["VITE_WIF_ADDRESS", config.tokenAddress], ["VITE_DAYMARK_ADDRESS", config.contractAddress]]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) problems.push(`${name} must be a deployed 20-byte contract address.`);
  }
  for (const [name, value] of [["VITE_WIF_CODE_HASH", config.tokenCodeHash], ["VITE_DAYMARK_CODE_HASH", config.contractCodeHash]]) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) problems.push(`${name} must be the independently verified runtime bytecode hash.`);
  }
  if (!/^https:\/\//i.test(config.explorerUrl)) problems.push("Set VITE_EXPLORER_URL to the chain explorer base URL.");
  return problems;
}
