const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, formatEther, parseEther } = require('ethers');
require('dotenv').config();

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", silver: "\x1b[38;5;250m"
};

// 1. BOOTSTRAP
console.clear();
console.log(`${TXT.bold}${TXT.gold}╔════════════════════════════════════════════════════════╗${TXT.reset}`);
console.log(`${TXT.bold}${TXT.gold}║   🔱 UNIVERSAL STRIKER | TRAFFIC CONTROL v41.1        ║${TXT.reset}`);
console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

const RAW_WSS = process.env.WSS_URL || "wss://base-rpc.publicnode.com";
const EXECUTION_URL = RAW_WSS.replace("wss://", "https://");

const CONFIG = {
    BENEFICIARY: "0x4B8251e7c80F910305bb81547e301DcB8A596918",
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    STRIKE_DATA: "0x535a720a000000000000000000000000420000000000000000000000000000060000000000000000000000004edbc9ba171790664872997239bc7a3f3a6331900000000000000000000000000000000000000000000000015af1d78b58c40000",
    
    // 🚦 TRAFFIC CONTROL
    SAMPLE_RATE: 0.20,            // Only analyze 20% of swaps to prevent 429 errors
    RPC_COOLDOWN_MS: 2000,        // 2 second rest between heavy simulations
    
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    GAS_LIMIT: 450000n,
    PRIORITY_BRIBE: 15n,
    MARGIN_ETH: "0.00005"
};

// Global State
let currentEthPrice = 0;
let nextNonce = 0;
let isProcessing = false; // Busy Lock
let cachedFeeData = null; // Fee Cache

async function startUniversalStriker() {
    let rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rawKey) { console.error(`${TXT.red}❌ FATAL: Private Key missing${TXT.reset}`); process.exit(1); }
    const cleanKey = rawKey.trim();

    try {
        const httpProvider = new JsonRpcProvider(EXECUTION_URL, CONFIG.CHAIN_ID, { staticNetwork: true });
        const wsProvider = new WebSocketProvider(RAW_WSS);
        const signer = new Wallet(cleanKey, httpProvider);

        const oracleContract = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes memory _data) public view returns (uint256)"], httpProvider);
        const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], httpProvider);

        // Sync initial state
        const [nonce, balance] = await Promise.all([
            httpProvider.getTransactionCount(signer.address),
            httpProvider.getBalance(signer.address)
        ]);
        nextNonce = nonce;
        cachedFeeData = await httpProvider.getFeeData();

        console.log(`${TXT.cyan}✅ STRIKER ONLINE${TXT.reset} | Treasury: ${formatEther(balance)} ETH`);

        // 1. HEARTBEAT: Price & Fee Sync (Every 15s)
        // Moving these calls here reduces RPC hits by 95%
        setInterval(async () => {
            try {
                const [[, price], fees] = await Promise.all([
                    priceFeed.latestRoundData(),
                    httpProvider.getFeeData()
                ]);
                currentEthPrice = Number(price) / 1e8;
                cachedFeeData = fees;
            } catch (e) { /* Fail silently to keep listener alive */ }
        }, 15000);

        // 2. THE UNIVERSAL LISTENER (Optimized)
        const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
        
        wsProvider.on({ topics: [swapTopic] }, async (log) => {
            // Optimization A: Sampling Filter
            if (Math.random() > CONFIG.SAMPLE_RATE) return;

            // Optimization B: Concurrency Lock
            if (isProcessing) return;

            try {
                isProcessing = true;
                await executeOmniscientStrike(httpProvider, signer, oracleContract);
                
                // Optimization C: Cooldown to prevent spamming
                setTimeout(() => { isProcessing = false; }, CONFIG.RPC_COOLDOWN_MS);
            } catch (e) {
                isProcessing = false;
            }
        });

        wsProvider.websocket.onclose = () => {
            console.warn(`\n${TXT.red}⚠️ CONNECTION LOST. REBOOTING...${TXT.reset}`);
            process.exit(1); 
        };

        // Suppress 429 errors from crashing the main process
        wsProvider.on("error", (e) => {
            if (e.message.includes("429")) {
                process.stdout.write(`${TXT.red}!${TXT.reset}`); // Visual rate-limit indicator
            }
        });

    } catch (e) {
        console.error(`\n${TXT.red}❌ CRITICAL: ${e.message}${TXT.reset}`);
        setTimeout(startUniversalStriker, 5000);
    }
}

async function executeOmniscientStrike(provider, signer, oracle) {
    try {
        // Use Cached Fee Data to avoid extra RPC calls
        const feeData = cachedFeeData || await provider.getFeeData();

        // 1. PRE-FLIGHT (Static Call + L1 Fee)
        const [simulation, l1Fee] = await Promise.all([
            provider.call({ to: CONFIG.TARGET_CONTRACT, data: CONFIG.STRIKE_DATA, from: signer.address }).catch(() => null),
            oracle.getL1Fee(CONFIG.STRIKE_DATA).catch(() => 0n)
        ]);

        if (!simulation) return;

        // 2. COST ANALYSIS
        const aggressivePriority = (feeData.maxPriorityFeePerGas * (100n + CONFIG.PRIORITY_BRIBE)) / 100n;
        const l2Cost = CONFIG.GAS_LIMIT * feeData.maxFeePerGas;
        const totalCost = l2Cost + l1Fee + parseEther(CONFIG.MARGIN_ETH);
        
        const netProfit = BigInt(simulation) - totalCost;

        // 3. EXECUTION
        if (netProfit > 0n) {
            const profitUSD = parseFloat(formatEther(netProfit)) * currentEthPrice;
            console.log(`\n${TXT.green}💎 ARBITRAGE DETECTED: +${formatEther(netProfit)} ETH (~$${profitUSD.toFixed(2)})${TXT.reset}`);
            
            const tx = await signer.sendTransaction({
                to: CONFIG.TARGET_CONTRACT,
                data: CONFIG.STRIKE_DATA,
                gasLimit: CONFIG.GAS_LIMIT,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: aggressivePriority,
                nonce: nextNonce++,
                type: 2,
                chainId: CONFIG.CHAIN_ID
            });
            
            console.log(`${TXT.cyan}🚀 BROADCASTED: ${tx.hash}${TXT.reset}`);
            await tx.wait();
            console.log(`${TXT.green}🎉 CONFIRMED. FUNDS SECURED.${TXT.reset}`);
        }
    } catch (e) {
        if (e.message.includes("nonce")) nextNonce = await provider.getTransactionCount(signer.address);
    }
}

// START
startUniversalStriker();
