// ===============================================================================
// APEX TITAN v125.0 (OMNISCIENT CONTINUOUS STRIKER) - EXECUTION GUARANTEE
// ===============================================================================
// UPGRADE: Static Strike Hammer + Continuous Simulation + Zero-Threshold Sniping
// TARGET BENEFICIARY: 0x35c3ECfFBBDd942a8DbA7587424b58f74d6d6d15
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios');
const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, formatEther, parseEther, Interface, AbiCoder, FallbackProvider } = require('ethers');
require('dotenv').config();

// --- SAFETY: GLOBAL ERROR HANDLERS ---
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('200') || msg.includes('429') || msg.includes('network') || msg.includes('coalesce')) return;
    console.error("\n\x1b[31m[SYSTEM ERROR]\x1b[0m", msg);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || "";
    if (msg.includes('200') || msg.includes('429') || msg.includes('network')) return;
});

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", gray: "\x1b[90m"
};

// --- CONFIGURATION ---
const GLOBAL_CONFIG = {
    BENEFICIARY: "0x35c3ECfFBBDd942a8DbA7587424b58f74d6d6d15",
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    
    // ⚡ STATIC STRIKE PAYLOAD (From Snippet)
    STRIKE_DATA: "0x535a720a00000000000000000000000042000000000000000000000000000000000000060000000000000000000000004edbc9ba171790664872997239bc7a3f3a6331900000000000000000000000000000000000000000000000015af1d78b58c40000",

    // ⚡ STRATEGY SETTINGS
    WHALE_THRESHOLD: parseEther("0.1"),  // ULTRA-SENSITIVE: Signal snipers on any notable move
    GAS_LIMIT: 400000n,                  // Optimized for your static strike
    MIN_NET_PROFIT: "0.0005",            // Target smaller, more frequent windows (~$1.75)
    MARGIN_ETH: "0.00005",               // Razor-thin safety buffer (~$0.15)
    PRIORITY_BRIBE: 15n,                 // 15% Tip for block priority

    RPC_POOL: [
        process.env.QUICKNODE_HTTP,
        process.env.BASE_RPC,
        "https://mainnet.base.org",
        "https://base.llamarpc.com",
        "https://1rpc.io/base"
    ].filter(url => url && url.startsWith("http")),

    MAX_CORES: Math.min(os.cpus().length, 48), 
    PORT: process.env.PORT || 8080,

    NETWORKS: [
        { 
            name: "BASE_MAINNET", chainId: 8453, 
            rpc: process.env.BASE_RPC, wss: process.env.BASE_WSS, 
            color: TXT.magenta, gasOracle: "0x420000000000000000000000000000000000000F", 
            priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", 
            router: "0x2626664c2603336E57B271c5C0b26F421741e481",
            weth: "0x4200000000000000000000000000000000000006"
        }
    ]
};

// --- MASTER PROCESS ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}
╔════════════════════════════════════════════════════════╗
║   ⚡ APEX TITAN v125.0 | OMNISCIENT CONTINUOUS STRIKER║
║   MODE: CONTINUOUS SIMULATION + STATIC PAYLOAD HAMMER ║
╚════════════════════════════════════════════════════════╝${TXT.reset}`);

    const cpuCount = GLOBAL_CONFIG.MAX_CORES;
    for (let i = 0; i < cpuCount; i++) cluster.fork();

    // IPC Signal Broadcaster
    cluster.on('message', (worker, msg) => {
        if (msg.type === 'EVENT_SIGNAL') {
            for (const id in cluster.workers) {
                cluster.workers[id].send(msg);
            }
        }
    });

    cluster.on('exit', (worker) => {
        setTimeout(() => cluster.fork(), 3000);
    });
} 
// --- WORKER PROCESS ---
else {
    const NETWORK = GLOBAL_CONFIG.NETWORKS[0]; // Focused on Base for lowest cost
    initWorker(NETWORK);
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    const DIVISION = (cluster.worker.id % 4);
    const ROLE = ["LISTENER", "SNIPER", "SNIPER", "ANALYST"][DIVISION];
    
    let isStriking = false;
    let currentEthPrice = 0;
    let nextNonce = 0;

    const rawKey = process.env.TREASURY_PRIVATE_KEY || process.env.PRIVATE_KEY || "";
    if (!rawKey.trim()) return;

    async function safeConnect() {
        try {
            const network = ethers.Network.from(CHAIN.chainId);
            const rpcConfigs = GLOBAL_CONFIG.RPC_POOL.map((url, i) => ({
                provider: new JsonRpcProvider(url, network, { staticNetwork: true }),
                priority: i + 1, stallTimeout: 2500
            }));
            const provider = new FallbackProvider(rpcConfigs, network, { quorum: 1 });
            const wsProvider = new WebSocketProvider(CHAIN.wss, network);
            
            const wallet = new Wallet(rawKey.trim(), provider);
            const priceFeed = new Contract(CHAIN.priceFeed, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);
            const gasOracle = new Contract(CHAIN.gasOracle, ["function getL1Fee(bytes) view returns (uint256)"], provider);

            console.log(`${TXT.green}✅ CORE ${cluster.worker.id} [${ROLE}] READY${TXT.reset}`);

            // Nonce Sync
            nextNonce = await provider.getTransactionCount(wallet.address);

            // ANALYST: Price Tracking
            if (ROLE === "ANALYST") {
                setInterval(async () => {
                    try {
                        const [, price] = await priceFeed.latestRoundData();
                        currentEthPrice = Number(price) / 1e8;
                    } catch (e) {}
                }, 10000);
            }

            // SNIPER: Respond to EVERY event signal
            process.on('message', async (msg) => {
                if (msg.type === 'EVENT_SIGNAL' && !isStriking && ROLE === "SNIPER") {
                    isStriking = true;
                    await executeStaticStrike(provider, wallet, gasOracle, currentEthPrice, CHAIN)
                        .finally(() => { isStriking = false; });
                }
            });

            // LISTENER: Detect ANY Swap to trigger cluster simulation
            if (ROLE === "LISTENER") {
                const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
                wsProvider.on({ topics: [swapTopic] }, () => {
                    process.send({ type: 'EVENT_SIGNAL' });
                });
                
                // Also trigger on new blocks
                wsProvider.on("block", () => {
                    process.send({ type: 'EVENT_SIGNAL' });
                });
            }

        } catch (e) { setTimeout(safeConnect, 15000); }
    }
    await safeConnect();
}

async function executeStaticStrike(provider, wallet, oracle, ethPrice, CHAIN) {
    try {
        // 1. PRE-FLIGHT (Static Call + Cost Analysis)
        const [simulation, l1Fee, feeData] = await Promise.all([
            provider.call({ to: GLOBAL_CONFIG.TARGET_CONTRACT, data: GLOBAL_CONFIG.STRIKE_DATA, from: wallet.address }).catch(() => null),
            oracle.getL1Fee(GLOBAL_CONFIG.STRIKE_DATA).catch(() => 0n),
            provider.getFeeData()
        ]);

        if (!simulation || simulation === "0x") return;

        // 2. COST BREAKDOWN
        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
        const l2Cost = GLOBAL_CONFIG.GAS_LIMIT * gasPrice;
        const totalCostThreshold = l2Cost + l1Fee + parseEther(GLOBAL_CONFIG.MIN_NET_PROFIT) + parseEther(GLOBAL_CONFIG.MARGIN_ETH);
        
        const rawProfit = BigInt(simulation);

        // 3. EXECUTION TRIGGER
        if (rawProfit > totalCostThreshold) {
            const netProfitEth = rawProfit - (l2Cost + l1Fee);
            console.log(`\n${TXT.green}${TXT.bold}💎 ARBITRAGE OPENED: +${formatEther(netProfitEth)} ETH (~$${(parseFloat(formatEther(netProfitEth)) * ethPrice).toFixed(2)})${TXT.reset}`);

            let priorityBribe = (feeData.maxPriorityFeePerGas * (100n + GLOBAL_CONFIG.PRIORITY_BRIBE)) / 100n;

            const tx = {
                to: GLOBAL_CONFIG.TARGET_CONTRACT, 
                data: GLOBAL_CONFIG.STRIKE_DATA, 
                type: 2, 
                chainId: CHAIN.chainId,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT, 
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: priorityBribe,
                nonce: await provider.getTransactionCount(wallet.address), // Fast nonce refresh
                value: 0n
            };

            const signedTx = await wallet.signTransaction(tx);
            const response = await axios.post(CHAIN.rpc, { 
                jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] 
            }, { timeout: 2000 }).catch(() => null);

            if (response?.data?.result) {
                console.log(`${TXT.green}${TXT.bold}🚀 STRIKE BROADCASTED: ${response.data.result}${TXT.reset}`);
            }
        } else {
            // Visual heartbeat to show simulation is running
            process.stdout.write(`${TXT.dim}.${TXT.reset}`);
        }
    } catch (e) {}
}
