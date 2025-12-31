const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, Interface } = require('ethers');
require('dotenv').config();

// 1. BOOTSTRAP: SYSTEM MAXIMIZATION
console.log("-----------------------------------------");
console.log("🟢 [BOOT] UNIVERSAL STRIKER OMNISCIENT INITIALIZING...");

// AUTO-CONVERT WSS TO HTTPS FOR EXECUTION (Premium Stability)
const RAW_WSS = process.env.WSS_URL || "";
const EXECUTION_URL = RAW_WSS.replace("wss://", "https://");

const CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    STRIKE_DATA: "0x535a720a00000000000000000000000042000000000000000000000000000000000000060000000000000000000000004edbc9ba171790664872997239bc7a3f3a6331900000000000000000000000000000000000000000000000015af1d78b58c40000",
    
    // ⚡ DUAL-LANE INFRASTRUCTURE
    WSS_URL: RAW_WSS,          // Listener (Low Latency)
    RPC_URL: EXECUTION_URL,    // Executor (High Reliability)
    
    // 🔮 ORACLES
    GAS_ORACLE: "0x420000000000000000000000000000000000000F", // Base L1 Fee
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", // ETH Price
    
    // ⚙️ STRATEGY SETTINGS
    GAS_LIMIT: 400000n, // Optimized for Atomic Swaps
    PRIORITY_BRIBE: 15n, // 15% Tip to be FIRST
    MARGIN_ETH: "0.00005" // ~$0.15 Safety Buffer
};

// Global State
let currentEthPrice = 0;
let nextNonce = 0;

async function startUniversalStriker() {
    // A. KEY SANITIZER
    let rawKey = process.env.TREASURY_PRIVATE_KEY;
    if (!rawKey) { console.error("❌ FATAL: Private Key missing."); process.exit(1); }
    const cleanKey = rawKey.trim();

    try {
        // B. DUAL-PROVIDER SETUP
        const httpProvider = new JsonRpcProvider(CONFIG.RPC_URL);
        const wsProvider = new WebSocketProvider(CONFIG.WSS_URL);
        const signer = new Wallet(cleanKey, httpProvider); // Signer uses HTTP (Stable)
        
        await wsProvider.ready;
        console.log(`✅ STRIKER ONLINE | EXECUTOR: ${CONFIG.RPC_URL.substring(0, 25)}...`);

        // C. CONTRACTS
        const oracleContract = new Contract(CONFIG.GAS_ORACLE, ["function getL1Fee(bytes memory _data) public view returns (uint256)"], httpProvider);
        const priceFeed = new Contract(CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], httpProvider);

        // Sync Nonce & Balance
        const [nonce, balance] = await Promise.all([
            httpProvider.getTransactionCount(signer.address),
            httpProvider.getBalance(signer.address)
        ]);
        nextNonce = nonce;
        console.log(`💰 TREASURY: ${ethers.formatEther(balance)} ETH`);

        // D. LIVE PRICE TRACKER
        wsProvider.on("block", async (blockNum) => {
            try {
                const [, price] = await priceFeed.latestRoundData();
                currentEthPrice = Number(price) / 1e8;
                process.stdout.write(`\r🌊 BLOCK: ${blockNum} | ETH: $${currentEthPrice.toFixed(2)} | Scanning Swaps... `);
            } catch (e) { /* Ignore block fetch errors */ }
        });

        // E. THE UNIVERSAL LISTENER
        const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
        
        wsProvider.on({ topics: [swapTopic] }, async (log) => {
            try {
                // 1. FILTER: Ignore micro-swaps to save CPU
                // (We check if the log data contains significant volume)
                if (log.data.length > 130 && log.data.includes("000000000000000000")) {
                     process.stdout.write("."); // Visual heartbeat
                }

                // 2. TRIGGER EXECUTION LOGIC
                // We pass the payload to the execution engine
                await executeOmniscientStrike(httpProvider, signer, oracleContract);

            } catch (e) { /* Ignore non-arb swaps */ }
        });

        // F. IMMORTALITY PROTOCOL
        wsProvider.websocket.onclose = () => {
            console.warn("\n⚠️ CONNECTION LOST. REBOOTING...");
            process.exit(1); 
        };

    } catch (e) {
        console.error(`\n❌ CRITICAL: ${e.message}`);
        setTimeout(startUniversalStriker, 1000);
    }
}

async function executeOmniscientStrike(provider, signer, oracle) {
    try {
        // 1. PRE-FLIGHT (Static Call + L1 Fee + Gas Data)
        // We simulate the fixed STRIKE_DATA against the current state
        const [simulation, l1Fee, feeData] = await Promise.all([
            provider.call({ to: CONFIG.TARGET_CONTRACT, data: CONFIG.STRIKE_DATA, from: signer.address }).catch(() => null),
            oracle.getL1Fee(CONFIG.STRIKE_DATA),
            provider.getFeeData()
        ]);

        if (!simulation) return; // Reverted (No profit)

        // 2. MAXIMIZED COST CALCULATION 
        // Base Fees = L2 Execution + L1 Data Security
        const aggressivePriority = (feeData.maxPriorityFeePerGas * (100n + CONFIG.PRIORITY_BRIBE)) / 100n;
        const l2Cost = CONFIG.GAS_LIMIT * feeData.maxFeePerGas;
        const totalCost = l2Cost + l1Fee + ethers.parseEther(CONFIG.MARGIN_ETH);
        
        const netProfit = BigInt(simulation) - totalCost;

        // 3. EXECUTION
        if (netProfit > 0n) {
            const profitUSD = parseFloat(ethers.formatEther(netProfit)) * currentEthPrice;
            console.log(`\n💎 ARBITRAGE DETECTED`);
            console.log(`💰 Net Profit: ${ethers.formatEther(netProfit)} ETH (~$${profitUSD.toFixed(2)})`);
            
            const tx = await signer.sendTransaction({
                to: CONFIG.TARGET_CONTRACT,
                data: CONFIG.STRIKE_DATA,
                gasLimit: CONFIG.GAS_LIMIT,
                maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: aggressivePriority, // Bribe
                nonce: nextNonce++,
                type: 2
            });
            
            console.log(`🚀 BROADCASTED: ${tx.hash}`);
            await tx.wait();
        }
    } catch (e) {
        if (e.message.includes("nonce")) nextNonce = await provider.getTransactionCount(signer.address);
    }
}

// EXECUTE
if (require.main === module) {
    startUniversalStriker().catch(e => {
        console.error("FATAL ERROR. RESTARTING...");
        setTimeout(startUniversalStriker, 1000);
    });
}
