import { formatUnits, getAddress } from "ethers";
import { config, configProblems } from "./config.js";
import { connectAccount, explorerAddressUrl, explorerTxUrl, readAccount, submitDailyClaim, verifyDeployment } from "./chain.js";
import "./style.css";

const root = document.querySelector("#app");
let account = "";
let snapshot = null;
let busy = false;
let message = "";
let messageKind = "info";
let txHash = "";
let readAt = "";
let lastReadUtcDay = -1;
let stale = false;

function esc(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function formatToken(value, decimals = 18) {
  const [whole, fraction = ""] = formatUnits(value, decimals).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const exactFraction = fraction.replace(/0+$/, "");
  return exactFraction ? `${grouped}.${exactFraction}` : grouped;
}

function render() {
  const problems = configProblems();
  const walletLabel = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : "Connect wallet";
  const browserUtcDay = Math.floor(Date.now() / 86_400_000);
  const alreadyChecked = snapshot && snapshot.lastDay === snapshot.chainDay;
  const isStale = stale || (snapshot && lastReadUtcDay !== browserUtcDay);
  root.innerHTML = `
    <main class="shell">
      <header class="topbar"><a class="wordmark" href="/" aria-label="Daymark home"><span class="mark">D</span> daymark</a><div class="network"><i></i> Robinhood Chain <span>· 4663</span></div><button id="connect" class="wallet" ${busy ? "disabled" : ""}>${esc(walletLabel)}</button></header>
      <section class="hero" aria-label="Daymark daily check-in"><img class="hero-image" src="/images/daymark-hero.png" alt="Misty moorland trail at golden hour, with a path leading toward the sunrise" fetchpriority="high"><div class="hero-copy"><p class="eyebrow">A small promise, kept daily</p><h1>Make today<br><em>count.</em></h1><p class="dek">A daily check-in with a real cost and a lasting record. One WIF is burned, your streak is written onchain, and tomorrow is yours to keep it going.</p>
        <div class="hero-actions"><button id="claim" class="claim" ${!account || busy || alreadyChecked || problems.length ? "disabled" : ""}>${busy ? "Working…" : alreadyChecked ? "Today is marked" : "Mark today · burn 1 WIF"}<span aria-hidden="true">↗</span></button><p>One claim per UTC day. Irreversible token burn.</p></div>
      </div></section>
      <section class="record" aria-labelledby="record-title"><img class="dashboard-image" src="/images/daymark-dashboard.png" alt="Misty moorland sunrise trail" loading="lazy"><div class="record-content"><div class="section-head"><div><p class="eyebrow">Your record</p><h2 id="record-title">A streak, kept in public.</h2></div><span class="live-tag"><i></i> ${account && snapshot ? (isStale ? "Cached read · stale" : "Read from chain") : "Waiting for wallet"}</span></div>
        <div class="stats"><article><span>Current streak</span><strong>${snapshot ? snapshot.streak : "—"}<small> days</small></strong><p>${snapshot ? (snapshot.streak ? "Keep showing up." : "Your first check-in starts it.") : "Connect a wallet to read state."}</p></article><article><span>Check-ins total</span><strong>${snapshot ? snapshot.totalClaims : "—"}</strong><p>Verified contract state</p></article><article><span>Today’s community</span><strong>${snapshot ? snapshot.todayClaims : "—"}</strong><p>Claims recorded for this UTC day</p></article></div>
        ${snapshot && account ? `<p class="provenance">Wallet <a href="${esc(explorerAddressUrl(account))}" target="_blank" rel="noreferrer">${esc(getAddress(account))} ↗</a> · WIF balance ${esc(formatToken(snapshot.balance, snapshot.decimals))} · token <a href="${esc(explorerAddressUrl(config.tokenAddress))}" target="_blank" rel="noreferrer">${esc(config.tokenAddress)} ↗</a> · contract <a href="${esc(explorerAddressUrl(config.contractAddress))}" target="_blank" rel="noreferrer">${esc(config.contractAddress)} ↗</a> · source: chain 4663 RPC · block ${snapshot.blockNumber} · read ${esc(readAt)} UTC <button id="refresh" class="refresh" ${busy ? "disabled" : ""}>Refresh state</button></p>` : ""}
      </div></section>
      <section class="how"><div class="section-head"><div><p class="eyebrow">The daily loop</p><h2>Small action. Real record.</h2></div></div><div class="steps"><article><b>01</b><h3>Show up</h3><p>Connect your wallet and see your actual onchain streak.</p></article><article><b>02</b><h3>Mark today</h3><p>Authorize exactly 1 WIF, then confirm today’s claim yourself.</p></article><article><b>03</b><h3>Come back</h3><p>Each UTC day gives your streak another chance to grow. Miss a day and it starts over.</p></article></div></section>
      <aside id="status" class="status ${messageKind}" role="status" aria-live="polite">${esc(message || (problems.length ? `Setup unavailable: ${problems.join(" ")}` : "Connect a wallet to read live onchain state."))}${txHash ? ` <a href="${esc(explorerTxUrl(txHash))}" target="_blank" rel="noreferrer">View transaction ↗</a>` : ""}</aside>
      ${problems.length ? `<details class="setup"><summary>Configuration needed</summary><p>${esc(problems.join(" "))}</p><p>Reads and claims stay disabled until the mainnet token and deployed contract are verified. See the deployment notes in the repository README.</p></details>` : ""}
      <footer><span>Daymark is independent and not affiliated with or endorsed by Robinhood Markets, Inc.</span><span>1 WIF is transferred to the dead address per claim. Included L2 transactions may reorganize before Ethereum posting.</span></footer>
    </main>`;
  root.querySelector("#connect")?.addEventListener("click", onConnect);
  root.querySelector("#claim")?.addEventListener("click", onClaim);
  root.querySelector("#refresh")?.addEventListener("click", onRefresh);
}

async function onRefresh() {
  if (!account || busy) return;
  busy = true; stale = true; message = "Reading current wallet and contract state from chain 4663…"; messageKind = "info"; render();
  try {
    const chain = Number(BigInt(await window.ethereum.request({ method: "eth_chainId" })));
    if (chain !== 4663) throw new Error(`Wallet is now on chain ${chain}; switch manually to chain 4663.`);
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (!accounts?.[0] || accounts[0].toLowerCase() !== account.toLowerCase()) throw new Error("Connected wallet changed. Reconnect to read the selected account.");
    await verifyDeployment();
    snapshot = await readAccount(account);
    readAt = new Date().toISOString();
    lastReadUtcDay = snapshot.chainDay; stale = false;
    message = "State refreshed from the configured Robinhood Chain RPC."; messageKind = "success";
  } catch (error) { message = error?.shortMessage || error?.message || "Could not refresh chain state."; messageKind = "error"; }
  finally { busy = false; render(); }
}

async function onConnect() {
  busy = true; snapshot = null; readAt = ""; stale = false; message = "Connecting and verifying mainnet contracts…"; messageKind = "info"; render();
  try {
    const verified = await verifyDeployment();
    account = await connectAccount();
    snapshot = await readAccount(account);
    if (snapshot.decimals !== verified.decimals) throw new Error("WIF decimals changed between deployment verification and account read.");
    readAt = new Date().toISOString();
    lastReadUtcDay = snapshot.chainDay; stale = false;
    message = `State read at ${readAt}. RPC chain, token bytecode, contract bytecode and WIF binding verified.`;
    messageKind = "success";
  } catch (error) { message = error?.shortMessage || error?.message || "Could not connect or read chain state."; messageKind = "error"; }
  finally { busy = false; render(); }
}

async function onClaim() {
  if (!account || busy) return;
  const accepted = window.confirm(`Signer: ${account}\nNetwork: Robinhood Chain (4663)\nSpend: exactly 1 WIF\nToken: ${config.tokenAddress || "(not configured)"}\nClaim contract: ${config.contractAddress || "(not configured)"}\nRecipient: 0x000000000000000000000000000000000000dEaD (irreversible transfer)\nGas: ETH, quoted by your wallet before each signature\n\nThis is not a payment to Daymark and cannot be recovered. Continue to preflight?`);
  if (!accepted) { message = "Claim canceled before any wallet transaction."; messageKind = "info"; render(); return; }
  busy = true; stale = true; message = "Preparing a wallet-confirmed WIF claim…"; messageKind = "info"; txHash = ""; render();
  try {
    const result = await submitDailyClaim(account, {
      onStage: (stage) => { message = stage; messageKind = "info"; render(); },
      onHash: (hash) => { txHash = hash; render(); },
    });
    snapshot = result.postState;
    readAt = new Date().toISOString();
    lastReadUtcDay = snapshot.chainDay; stale = false;
    message = `Claim included in Robinhood Chain block ${result.receipt.blockNumber}; receipt, WIF transfer event and contract state were read back at ${readAt}. This is sequencer inclusion, not Ethereum finality. Streak: ${snapshot.streak} day${snapshot.streak === 1n ? "" : "s"}.`;
    messageKind = "success";
  } catch (error) { stale = true; message = error?.shortMessage || error?.message || "Claim did not complete."; messageKind = "error"; }
  finally { busy = false; render(); }
}

window.ethereum?.on?.("accountsChanged", (accounts) => {
  account = accounts?.[0] || ""; snapshot = null; readAt = ""; stale = false; message = account ? "Wallet changed. Read its chain state again." : "Wallet disconnected."; messageKind = "info"; render();
});
window.ethereum?.on?.("chainChanged", () => {
  snapshot = null; readAt = ""; stale = false; message = "Wallet network changed. The app requires chain 4663; switch manually and reconnect."; messageKind = "error"; render();
});
render();
window.setInterval(() => { if (snapshot) render(); }, 30_000);
