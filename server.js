// ===============================================================================
// APEX UNIVERSAL STRIKER v45.0 (RESILIENT) - OMNISCIENT MEV ENGINE
// ===============================================================================

const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, formatEther, parseEther } = require('ethers');
require('dotenv').config();

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", silver: "\x1b[38;5;250m"
};

// --- CONFIGURATION ---
const CONFIG = {
    BENEFICIARY: "0x4B8251e7c80F910305bb81547e301DcB8A596918",
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    
    // executeFlashArbitrage(WETH, DEGEN, 2500 ETH)
    STRIKE_DATA: "0x535a720a000000000000000000000000420000000000000000000000000000060000000000000000000000004edbc9ba171790664872997239bc7a3f3a6331900000000000000000000000000000000000000000000000015af1d78b58c40000",
    
    // 🚦 TRAFFIC CONTROL (v45.0 FIX)
    SAMPLE_RATE: 0.20,            // Only analyze 20% of swaps to stay under limits
    RPC_COOLDOWN_MS: 3000,        // 3s rest between strikes
    BACKOFF_BASE_MS: 5000,        // Starting backoff for 429 errors
    
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
    GAS_LIMIT: 450000n,
    PRIORITY_BRIBE: 15n,
    MARGIN_ETH: "0.00005"
};

// Global State
let currentEthPrice = 0;
let nextNonce = 0;
let isProcessing = false; 
let cachedFeeData = null;
let retryCount = 0;

// --- SAFETY: GLOBAL ERROR HANDLERS ---
process.on('uncaughtException', (err) => {
    if (err.message.includes('429')) return; // Silently handle rate limits
    console.error("\n\x1b[31m[CRITICAL ERROR]\x1b[0m", err.message);
});

async function startUniversalStriker() {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔════════════════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   🔱 UNIVERSAL STRIKER | RESILIENT ENGINE v45.0      ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   STATUS: MONITORING TRAFFIC + AUTO-BACKOFF          ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    const RAW_WSS = process.env.WSS_URL || "wss://base-rpc.publicnode.com";
    const EXECUTION_URL = RAW_WSS.replace("wss://", "https://");

    let rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!rawKey) { console.error(`${TXT.red}❌ FATAL: Private Key missing${TXT.reset}`); process.exit(1); }
    const cleanKey = rawKey.trim();

    try {
        // Inject hardcoded network to skip RPC detection probe
        const netObj = { name: 'base', chainId: CONFIG.CHAIN_ID };
        const httpProvider = new JsonRpcProvider(EXECUTION_URL, netObj, { staticNetwork: true });
        const wsProvider = new WebSocketProvider(RAW_WSS, netObj);
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
        retryCount = 0; 

        console.log(`${TXT.cyan}✅ STRIKER ONLINE${TXT.reset} | Treasury: ${formatEther(balance)} ETH`);
        console.log(`${TXT.magenta}🎯 PROFIT TARGET: ${CONFIG.BENEFICIARY}${TXT.reset}\n`);

        // 1. HEARTBEAT: Price & Fee Sync (Low Frequency)
        setInterval(async () => {
            if (isProcessing) return;
            try {
                const [[, price], fees] = await Promise.all([
                    priceFeed.latestRoundData().catch(() => [0, 0]),
                    httpProvider.getFeeData().catch(() => null)
                ]);
                if (price) currentEthPrice = Number(price) / 1e8;
                if (fees) cachedFeeData = fees;
            } catch (e) {}
        }, 20000);

        // 2. THE UNIVERSAL LISTENER
        const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
        
        wsProvider.on({ topics: [swapTopic] }, async (log) => {
            // Traffic Control: Sample 20% of swaps and skip if currently simulating
            if (Math.random() > CONFIG.SAMPLE_RATE) return;
            if (isProcessing) return;

            try {
                isProcessing = true;
                await executeOmniscientStrike(httpProvider, signer, oracleContract);
                // Set cooldown to let RPC reset
                setTimeout(() => { isProcessing = false; }, CONFIG.RPC_COOLDOWN_MS);
            } catch (e) {
                isProcessing = false;
            }
        });

        // 3. AUTO-RECOVERY & 429 HANDLING
        wsProvider.on("error", (e) => {
            if (e.message.includes("429")) {
                const wait = CONFIG.BACKOFF_BASE_MS * Math.min(retryCount + 1, 6);
                process.stdout.write(`\n${TXT.red}🚫 RATE LIMITED (429). Sleeping ${wait/1000}s...${TXT.reset}\n`);
                retryCount++;
                wsProvider.destroy();
                setTimeout(startUniversalStriker, wait);
            }
        });

        wsProvider.websocket.onclose = () => {
            if (retryCount === 0) {
                console.warn(`\n${TXT.yellow}⚠️ CONNECTION LOST. REBOOTING...${TXT.reset}`);
                startUniversalStriker();
            }
        };

    } catch (e) {
        if (e.message.includes("429")) {
            const wait = CONFIG.BACKOFF_BASE_MS * 2;
            console.error(`${TXT.red}❌ RPC BUSY. BACKOFF: ${wait/1000}s...${TXT.reset}`);
            setTimeout(startUniversalStriker, wait);
        } else {
            console.error(`\n${TXT.red}❌ BOOT ERROR: ${e.message}${TXT.reset}`);
            setTimeout(startUniversalStriker, 10000);
        }
    }
}

async function executeOmniscientStrike(provider, signer, oracle) {
    try {
        const feeData = cachedFeeData || await provider.getFeeData();

        // PRE-FLIGHT (Static Call + L1 Fee)
        const [simulation, l1Fee] = await Promise.all([
            provider.call({ to: CONFIG.TARGET_CONTRACT, data: CONFIG.STRIKE_DATA, from: signer.address }).catch(() => null),
            oracle.getL1Fee(CONFIG.STRIKE_DATA).catch(() => 0n)
        ]);

        if (!simulation) {
             process.stdout.write(`${TXT.dim}.${TXT.reset}`);
             return;
        }

        const aggressivePriority = (feeData.maxPriorityFeePerGas * (100n + CONFIG.PRIORITY_BRIBE)) / 100n;
        const l2Cost = CONFIG.GAS_LIMIT * feeData.maxFeePerGas;
        const totalCost = l2Cost + l1Fee + parseEther(CONFIG.MARGIN_ETH);
        
        const netProfit = BigInt(simulation) - totalCost;

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
            console.log(`${TXT.green}🎉 CONFIRMED. FUNDS SECURED AT ${CONFIG.BENEFICIARY}${TXT.reset}`);
        }
    } catch (e) {
        if (e.message.includes("nonce")) nextNonce = await provider.getTransactionCount(signer.address);
    }
}

// START
startUniversalStriker();
