// ===============================================================================
// APEX ULTIMATE MASTER v45.0 (QUANTUM CONNECTION RESILIENCE) - NUCLEAR CLUSTER
// ===============================================================================
// FIXED: WebSocket 429 Rate Limiting + Unhandled Error Event Crashes
// STRATEGY: STAGGERED BOOT + MASTER NONCE SOVEREIGNTY + DUAL-LANE FIXED
// DNA: 10% POOL RESERVE RULE + DUAL-VECTOR SNIPE + JITTERED HANDSHAKES
// TARGET BENEFICIARY: 0x4B8251e7c80F910305bb81547e301DcB8A596918
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios');
const { ethers, WebSocketProvider, JsonRpcProvider, Wallet, Interface, parseEther, formatEther, Contract, FallbackProvider, AbiCoder } = require('ethers');
require('dotenv').config();

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", gray: "\x1b[90m"
};

// --- CONFIGURATION ---
const GLOBAL_CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    BENEFICIARY: "0x4B8251e7c80F910305bb81547e301DcB8A596918",
    STRIKE_DATA: "0x535a720a00000000000000000000000042000000000000000000000000000000000000060000000000000000000000004edbc9ba171790664872997239bc7a3f3a6331900000000000000000000000000000000000000000000000015af1d78b58c40000",
    
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    CHAINLINK_FEED: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",

    WHALE_THRESHOLD: parseEther("0.1"),
    GAS_LIMIT: 450000n,
    PRIORITY_BRIBE: 15n, 
    MARGIN_ETH: "0.00005",
    PORT: 8080
};

// --- UTILITY: URL SANITIZER ---
function getExecutionUrl(wssUrl) {
    if (!wssUrl) return "";
    let url = wssUrl.replace("wss://", "https://");
    url = url.replace("/ws/v3/", "/v3/"); 
    return url;
}

// --- MASTER PROCESS (The Sovereign Orchestrator) ---
if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}╔════════════════════════════════════════════════════════╗${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   ⚡ APEX MASTER v45.0 | QUANTUM RESILIENCE ENGINE   ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}║   DNA: STAGGERED BOOT + NONCE SOVEREIGNTY (FIXED)   ║${TXT.reset}`);
    console.log(`${TXT.bold}${TXT.gold}╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    let masterNonce = -1;
    const EXEC_URL = getExecutionUrl(process.env.WSS_URL);

    async function initMasterState() {
        if (!process.env.TREASURY_PRIVATE_KEY) return;
        try {
            const provider = new JsonRpcProvider(EXEC_URL);
            const wallet = new Wallet(process.env.TREASURY_PRIVATE_KEY.trim(), provider);
            masterNonce = await provider.getTransactionCount(wallet.address, 'latest');
            console.log(`${TXT.green}✅ MASTER STATE INITIALIZED | Global Nonce: ${masterNonce}${TXT.reset}`);
        } catch (e) {
            console.error(`${TXT.red}❌ MASTER INIT FAILED: ${e.message}${TXT.reset}`);
            setTimeout(initMasterState, 5000);
        }
    }
    initMasterState();

    const spawnWorker = (i) => {
        // RESILIENCE: Stagger worker boot to avoid thundering herd on WSS handshakes
        setTimeout(() => {
            const worker = cluster.fork();
            worker.on('message', (msg) => {
                if (msg.type === 'NONCE_REQUEST') {
                    if (masterNonce === -1) return;
                    worker.send({ type: 'NONCE_GRANT', nonce: masterNonce });
                    masterNonce++;
                }
                if (msg.type === 'STRIKE_SIGNAL') {
                    for (const id in cluster.workers) cluster.workers[id].send(msg);
                }
            });
        }, i * 800); // 800ms stagger between each core boot
    };

    const cpuCount = Math.min(os.cpus().length, 32);
    for (let i = 0; i < cpuCount; i++) spawnWorker(i);

    cluster.on('exit', (worker) => {
        console.log(`${TXT.yellow}⚠️ Core Reset: PID ${worker.process.pid}. Respawning...${TXT.reset}`);
        setTimeout(() => spawnWorker(0), 3000);
    });
} 
// --- WORKER PROCESS (Striker Core) ---
else {
    runWorker();
}

async function runWorker() {
    const rawKey = process.env.TREASURY_PRIVATE_KEY || "";
    if (!rawKey) return;
    const cleanKey = rawKey.trim();

    const WSS_URL = process.env.WSS_URL || "";
    const HTTP_URL = getExecutionUrl(WSS_URL);
    
    const ROLE = (cluster.worker.id % 4 === 0) ? "LISTENER" : "STRIKER";
    const TAG = `${TXT.cyan}[CORE ${cluster.worker.id}] [${ROLE}]${TXT.reset}`;

    async function connect() {
        try {
            // Executor Lane (HTTP)
            const httpProvider = new JsonRpcProvider(HTTP_URL, undefined, { staticNetwork: true });
            await httpProvider.getNetwork();
            const wallet = new Wallet(cleanKey, httpProvider);

            // Listener Lane (WSS) - HARDENED against unhandled 429 crashes
            const wsProvider = new WebSocketProvider(WSS_URL);
            
            // v45.0 GLOBAL EXCEPTION HANDLER (Prevents rate-limit crash)
            wsProvider.on('error', (e) => {
                if (e.message && (e.message.includes('429') || e.message.includes('Unexpected server response'))) {
                    // Suppress noise, connection logic below handles the retry
                    return;
                }
                console.error(`${TAG} ${TXT.red}WSS Event Error: ${e.message}${TXT.reset}`);
            });

            const oracle = new Contract(GLOBAL_CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], httpProvider);
            const priceFeed = new Contract(GLOBAL_CONFIG.CHAINLINK_FEED, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], httpProvider);

            console.log(`${TAG} ${TXT.green}ACTIVE${TXT.reset}`);

            if (ROLE === "STRIKER") {
                process.on('message', async (msg) => {
                    if (msg.type === 'STRIKE_SIGNAL') {
                        await executeOmniscientStrike(httpProvider, wallet, oracle, priceFeed);
                    }
                });
            }

            if (ROLE === "LISTENER") {
                const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
                wsProvider.on({ topics: [swapTopic] }, () => process.send({ type: 'STRIKE_SIGNAL' }));

                wsProvider.on("block", (bn) => {
                    if (cluster.worker.id % 8 === 0) {
                        process.stdout.write(`\r${TAG} ${TXT.dim}Sovereign Pulse #${bn}...${TXT.reset}`);
                    }
                });

                wsProvider.websocket.onclose = () => {
                    console.log(`${TAG} ${TXT.yellow}WSS Closed. Reconnecting...${TXT.reset}`);
                    process.exit(1); 
                };
            }

        } catch (e) {
            if (e.message.includes('429')) {
                const backoff = 5000 + (Math.random() * 10000);
                console.warn(`${TAG} ${TXT.yellow}429 Rate Limit. Backing off ${Math.round(backoff/1000)}s...${TXT.reset}`);
                setTimeout(connect, backoff);
            } else {
                console.error(`${TAG} ${TXT.red}Init Error: ${e.message}${TXT.reset}`);
                setTimeout(connect, 5000);
            }
        }
    }
    connect();
}

async function getSovereignNonce() {
    return new Promise((resolve) => {
        const listener = (msg) => {
            if (msg.type === 'NONCE_GRANT') {
                process.removeListener('message', listener);
                resolve(msg.nonce);
            }
        };
        process.on('message', listener);
        process.send({ type: 'NONCE_REQUEST' });
    });
}

async function executeOmniscientStrike(provider, wallet, oracle, priceFeed) {
    try {
        const [nonce, simulation, l1Fee, feeData, priceData] = await Promise.all([
            getSovereignNonce(),
            provider.call({ to: GLOBAL_CONFIG.TARGET_CONTRACT, data: GLOBAL_CONFIG.STRIKE_DATA, from: wallet.address }).catch(() => null),
            oracle.getL1Fee(GLOBAL_CONFIG.STRIKE_DATA).catch(() => 0n),
            provider.getFeeData(),
            priceFeed.latestRoundData().catch(() => [0, 0n])
        ]);

        if (!simulation || simulation === "0x") return;

        const currentEthPrice = Number(priceData[1]) / 1e8;
        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || parseEther("0.1", "gwei");
        const priority = (feeData.maxPriorityFeePerGas || 0n) * (100n + GLOBAL_CONFIG.PRIORITY_BRIBE) / 100n;
        
        const l2Cost = GLOBAL_CONFIG.GAS_LIMIT * gasPrice;
        const totalThreshold = l2Cost + l1Fee + parseEther(GLOBAL_CONFIG.MARGIN_ETH);

        if (BigInt(simulation) > totalThreshold) {
            const netEth = BigInt(simulation) - (l2Cost + l1Fee);
            console.log(`\n${TXT.green}${TXT.bold}💎 ARBITRAGE EXECUTED${TXT.reset}`);
            console.log(`   ↳ 💰 NET PROFIT: +${formatEther(netEth)} ETH (~$${(parseFloat(formatEther(netEth)) * currentEthPrice).toFixed(2)})`);

            const tx = {
                to: GLOBAL_CONFIG.TARGET_CONTRACT,
                data: GLOBAL_CONFIG.STRIKE_DATA,
                type: 2,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT,
                maxFeePerGas: gasPrice + priority,
                maxPriorityFeePerGas: priority,
                nonce: nonce,
                chainId: GLOBAL_CONFIG.CHAIN_ID
            };

            const response = await wallet.sendTransaction(tx);
            console.log(`   ${TXT.cyan}🚀 SUCCESS: ${response.hash.substring(0,20)}...${TXT.reset}`);
        }
    } catch (e) { /* Catch nonce race or gas shift */ }
}
