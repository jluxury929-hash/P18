// ===============================================================================
// APEX TITAN v77.1 (PROFIT-GATE RESILIENCE) - FINAL ENGINE
// ===============================================================================
// MERGE SYNC: v77.0 (BASE) + PROFIT-GATE SAFETY + GAS COST CALCULATION
// ===============================================================================

const cluster = require('cluster');
const os = require('os');
const http = require('http');
const axios = require('axios');
const { ethers, Wallet, WebSocketProvider, JsonRpcProvider, Contract, formatEther, parseEther, Interface, AbiCoder } = require('ethers');
require('dotenv').config();

// --- SAFETY: GLOBAL ERROR HANDLERS ---
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('200')) return;
    if (msg.includes('429') || msg.includes('network') || msg.includes('coalesce') || msg.includes('subscribe') || msg.includes('infura')) return; 
    if (msg.includes('401')) {
        console.error("\n\x1b[31m[AUTH ERROR] 401 Unauthorized: Invalid API Key in .env\x1b[0m");
        return;
    }
    console.error("\n\x1b[31m[SYSTEM ERROR]\x1b[0m", msg);
});

process.on('unhandledRejection', (reason) => {
    const msg = reason?.message || "";
    if (msg.includes('200') || msg.includes('429') || msg.includes('network') || msg.includes('coalesce') || msg.includes('401')) return;
});

// --- FLASHBOTS INTEGRATION ---
let FlashbotsBundleProvider;
let hasFlashbots = false;
try {
    ({ FlashbotsBundleProvider } = require('@flashbots/ethers-provider-bundle'));
    hasFlashbots = true;
} catch (e) {
    if (cluster.isPrimary) console.log("\x1b[33m%s\x1b[0m", "⚠️ Flashbots dependency missing. Private bundling restricted.");
}

// --- THEME ENGINE ---
const TXT = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", 
    magenta: "\x1b[35m", blue: "\x1b[34m", red: "\x1b[31m",
    gold: "\x1b[38;5;220m", gray: "\x1b[90m"
};

// --- CONFIGURATION ---
const GLOBAL_CONFIG = {
    TARGET_CONTRACT: process.env.EXECUTOR_CONTRACT || "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    // SAFETY FIX: Changed to a placeholder. DO NOT USE THE PREVIOUS HARDCODED ADDRESS.
    BENEFICIARY: process.env.BENEFICIARY || "0xYOUR_PUBLIC_WALLET_ADDRESS",
    
    // 🚦 TRAFFIC CONTROL
    MAX_CORES: Math.min(os.cpus().length, 16), 
    MEMPOOL_SAMPLE_RATE: 0.015,
    WORKER_BOOT_DELAY_MS: 45000, 
    HEARTBEAT_INTERVAL_MS: 180000, 
    RPC_COOLDOWN_MS: 45000,      
    RATE_LIMIT_SLEEP_MS: 600000, 
    MAX_LOCAL_RECONNECTS: 3,     
    PORT: process.env.PORT || 8080,
    
    // 🐋 STRATEGY SETTINGS
    WHALE_THRESHOLD: parseEther("10.0"), 
    MIN_LOG_ETH: parseEther("10.0"),
    GAS_LIMIT: 1400000n,
    MARGIN_ETH: "0.015",
    PRIORITY_BRIBE: 15n, 
    QUANTUM_BRIBE_MAX: 99.5,
    CROSS_CHAIN_PROBE: true,

    NETWORKS: [
        {
            name: "ETH_MAINNET",
            chainId: 1,
            rpc: process.env.ETH_RPC || "https://rpc.flashbots.net",
            wss: process.env.ETH_WSS || "wss://ethereum-rpc.publicnode.com", 
            type: "FLASHBOTS",
            relay: "https://relay.flashbots.net",
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
            priceFeed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
            weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            color: TXT.cyan
        },
        {
            name: "BASE_MAINNET",
            chainId: 8453,
            rpc: process.env.BASE_RPC || "https://mainnet.base.org",
            wss: process.env.BASE_WSS || "wss://base-rpc.publicnode.com",
            uniswapRouter: "0x2626664c2603336E57B271c5C0b26F421741e481", 
            priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
            weth: "0x4200000000000000000000000000000000000006",
            gasOracle: "0x420000000000000000000000000000000000000F",
            color: TXT.magenta
        },
        {
            name: "ARBITRUM",
            chainId: 42161,
            rpc: process.env.ARB_RPC || "https://arb1.arbitrum.io/rpc",
            wss: process.env.ARB_WSS || "wss://arb1.arbitrum.io/feed",
            uniswapRouter: "0xE592427A0AEce92De3Edee1F18E0157C05861564", 
            priceFeed: "0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612",
            weth: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            color: TXT.blue
        }
    ]
};

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.bold}${TXT.gold}
╔════════════════════════════════════════════════════════╗
║   ⚡ APEX TITAN v77.1 | PROFIT-GATE OVERLORD         ║
║   SAFETY: AUTOMATIC GAS PROTECTION + BACKDOOR SHIELD  ║
╚════════════════════════════════════════════════════════╝${TXT.reset}`);

    // BACKDOOR SHIELD: Prevents execution if the suspicious address is detected
    if (GLOBAL_CONFIG.BENEFICIARY.toLowerCase() === "0x4b8251e7c80f910305bb81547e301dcb8a596918") {
        console.error(`${TXT.red}${TXT.bold}[FATAL ERROR] Backdoor Address Detected!${TXT.reset}`);
        console.error(`${TXT.yellow}You are using the malicious hardcoded Beneficiary address.
The bot has been halted to save your crypto. Update BENEFICIARY in .env or config.${TXT.reset}`);
        process.exit(1);
    }

    const cpuCount = GLOBAL_CONFIG.MAX_CORES;
    const workers = [];
    const spawnWorker = (i) => {
        if (i >= cpuCount) return;
        const worker = cluster.fork();
        worker.on('message', (msg) => {
            if (msg.type === 'WHALE_SIGNAL') {
                Object.values(cluster.workers).forEach(w => w.send(msg));
            }
        });
        setTimeout(() => spawnWorker(i + 1), GLOBAL_CONFIG.WORKER_BOOT_DELAY_MS);
    };
    spawnWorker(0);
} 
else {
    const networkIndex = (cluster.worker.id - 1) % GLOBAL_CONFIG.NETWORKS.length;
    const NETWORK = GLOBAL_CONFIG.NETWORKS[networkIndex];
    const startDelay = (cluster.worker.id % 24) * 12000;
    setTimeout(() => {
        initWorker(NETWORK).catch(() => process.exit(1));
    }, startDelay);
}

async function initWorker(CHAIN) {
    const TAG = `${CHAIN.color}[${CHAIN.name}]${TXT.reset}`;
    const DIVISION = (cluster.worker.id % 3);
    const ROLE = ["SNIPER", "DECODER", "PROBER"][DIVISION];
    
    let isProcessing = false;
    let currentEthPrice = 0;
    let localReconnects = 0;
    const walletKey = (process.env.PRIVATE_KEY || "").trim();

    async function safeConnect() {
        try {
            const netObj = ethers.Network.from(CHAIN.chainId);
            const provider = new JsonRpcProvider(CHAIN.rpc, netObj, { staticNetwork: true, batchMaxCount: 1 });
            const wsProvider = new WebSocketProvider(CHAIN.wss, netObj);
            
            wsProvider.on('error', (e) => {
                if (e.message.includes("429") || e.message.includes("coalesce")) process.stdout.write(`${TXT.red}!${TXT.reset}`);
            });

            if (wsProvider.websocket) {
                wsProvider.websocket.onclose = () => {
                    if (localReconnects < GLOBAL_CONFIG.MAX_LOCAL_RECONNECTS) {
                        localReconnects++;
                        setTimeout(safeConnect, 15000);
                    } else { process.exit(1); }
                };
            }

            const wallet = new Wallet(walletKey, provider);
            const priceFeed = new Contract(CHAIN.priceFeed, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], provider);
            const gasOracle = CHAIN.gasOracle ? new Contract(CHAIN.gasOracle, ["function getL1Fee(bytes memory _data) public view returns (uint256)"], provider) : null;
            const poolContract = CHAIN.chainId === 8453 ? new Contract(GLOBAL_CONFIG.WETH_USDC_POOL, ["function getReserves() external view returns (uint112, uint112, uint32)"], provider) : null;

            let fbProvider = null;
            if (CHAIN.type === "FLASHBOTS" && hasFlashbots) {
                fbProvider = await FlashbotsBundleProvider.create(provider, wallet, CHAIN.relay);
            }

            setInterval(async () => {
                if (isProcessing) return;
                try {
                    const [, price] = await priceFeed.latestRoundData();
                    currentEthPrice = Number(price) / 1e8;
                } catch (e) {}
            }, GLOBAL_CONFIG.HEARTBEAT_INTERVAL_MS);

            const apexIface = new Interface([
                "function executeFlashArbitrage(address tokenA, address tokenOut, uint256 amount)",
                "function executeTriangle(address[] path, uint256 amount)",
                "function requestTitanLoan(address _token, uint256 _amount, address[] calldata _path)"
            ]);

            console.log(`${TXT.green}✅ CORE ${cluster.worker.id} STATIC SYNCED [${ROLE}] on ${TAG}${TXT.reset}`);

            process.on('message', async (msg) => {
                if (msg.type === 'WHALE_SIGNAL' && msg.chainId === CHAIN.chainId && !isProcessing) {
                    isProcessing = true;
                    await strike(provider, wallet, fbProvider, apexIface, poolContract, gasOracle, currentEthPrice, CHAIN, msg.target, "IPC_STRIKE");
                    setTimeout(() => isProcessing = false, GLOBAL_CONFIG.RPC_COOLDOWN_MS);
                }
            });

            setTimeout(() => {
                if (DIVISION === 0) {
                    wsProvider.on("pending", async (txHash) => {
                        if (isProcessing) return;
                        if (Math.random() > GLOBAL_CONFIG.MEMPOOL_SAMPLE_RATE) return; 
                        try {
                            const tx = await provider.getTransaction(txHash).catch(() => null);
                            if (tx && tx.to && tx.value >= GLOBAL_CONFIG.WHALE_THRESHOLD) {
                                if (tx.to.toLowerCase() === CHAIN.uniswapRouter.toLowerCase()) {
                                    process.send({ type: 'WHALE_SIGNAL', chainId: CHAIN.chainId, target: tx.to });
                                    isProcessing = true;
                                    await strike(provider, wallet, fbProvider, apexIface, poolContract, gasOracle, currentEthPrice, CHAIN, tx.to, "PRIMARY_SNIPE");
                                    setTimeout(() => isProcessing = false, GLOBAL_CONFIG.RPC_COOLDOWN_MS);
                                }
                            }
                        } catch (err) {}
                    });
                } else if (DIVISION === 1) {
                    const swapTopic = ethers.id("Swap(address,uint256,uint256,uint256,uint256,address)");
                    wsProvider.on({ topics: [swapTopic] }, async (log) => {
                        if (isProcessing) return;
                        try {
                            const decoded = AbiCoder.defaultAbiCoder().decode(["uint256", "uint256", "uint256", "uint256"], log.data);
                            const maxVal = decoded.reduce((max, val) => val > max ? val : max, 0n);
                            if (maxVal >= GLOBAL_CONFIG.LEVIATHAN_MIN_ETH) {
                                process.send({ type: 'WHALE_SIGNAL', chainId: CHAIN.chainId, target: log.address });
                                isProcessing = true;
                                await strike(provider, wallet, fbProvider, apexIface, poolContract, gasOracle, currentEthPrice, CHAIN, log.address, "LEVIATHAN_STRIKE");
                                setTimeout(() => isProcessing = false, GLOBAL_CONFIG.RPC_COOLDOWN_MS);
                            }
                        } catch (e) {}
                    });
                } else {
                    setInterval(async () => {
                        if (isProcessing || !GLOBAL_CONFIG.CROSS_CHAIN_PROBE) return; 
                        isProcessing = true;
                        await strike(provider, wallet, fbProvider, apexIface, poolContract, gasOracle, currentEthPrice, CHAIN, "0x...", "TRIANGLE_PROBE");
                        setTimeout(() => isProcessing = false, GLOBAL_CONFIG.RPC_COOLDOWN_MS);
                    }, 120000 + (Math.random() * 60000));
                }
            }, 60000);

        } catch (e) {
            setTimeout(safeConnect, 60000);
        }
    }
    await safeConnect();
}

async function strike(provider, wallet, fbProvider, iface, pool, gasOracle, ethPrice, CHAIN, target, mode) {
    try {
        const balanceWei = await provider.getBalance(wallet.address).catch(() => 0n);
        let loanAmount = balanceWei > parseEther("0.1") ? parseEther("100") : parseEther("25");

        if (pool && CHAIN.chainId === 8453) {
            const [res0] = await pool.getReserves().catch(() => [0n]);
            const poolLimit = BigInt(res0) / 8n;
            if (loanAmount > poolLimit) loanAmount = poolLimit;
        }

        let txData;
        if (mode === "TRIANGLE_PROBE") {
            const path = [CHAIN.weth, GLOBAL_CONFIG.USDC, GLOBAL_CONFIG.CBETH, CHAIN.weth]; 
            txData = iface.encodeFunctionData("executeTriangle", [path, parseEther("25")]);
        } else {
            txData = iface.encodeFunctionData("executeFlashArbitrage", [CHAIN.weth, target, 0]);
        }
        
        // --- PROFIT-GATE SAFETY LOGIC ---
        const [simulation, feeData] = await Promise.all([
            provider.call({ to: GLOBAL_CONFIG.TARGET_CONTRACT, data: txData, from: wallet.address, gasLimit: GLOBAL_CONFIG.GAS_LIMIT }).catch(() => null),
            provider.getFeeData()
        ]);

        if (!simulation || simulation === "0x") return;

        const rawProfit = BigInt(simulation);
        const l2GasCost = GLOBAL_CONFIG.GAS_LIMIT * feeData.maxFeePerGas;
        const l1Fee = gasOracle ? await gasOracle.getL1Fee(txData).catch(() => 0n) : 0n;
        const totalGasCost = l2GasCost + l1Fee;
        
        // Only authorize if Profit > (Total Gas Cost + 20% Safety Buffer)
        const safetyThreshold = (totalGasCost * 120n) / 100n;

        if (rawProfit > safetyThreshold) {
            const netProfit = rawProfit - totalGasCost;
            console.log(`\n${TXT.green}${TXT.bold}✅ PROFIT AUTHORIZED: +${formatEther(netProfit)} ETH (~$${(parseFloat(formatEther(netProfit)) * ethPrice).toFixed(2)})${TXT.reset}`);
            
            const aggressivePriority = feeData.maxPriorityFeePerGas + ((feeData.maxPriorityFeePerGas * GLOBAL_CONFIG.PRIORITY_BRIBE) / 100n);

            const tx = {
                to: GLOBAL_CONFIG.TARGET_CONTRACT, data: txData, type: 2, chainId: CHAIN.chainId,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT, maxFeePerGas: feeData.maxFeePerGas,
                maxPriorityFeePerGas: aggressivePriority, nonce: await provider.getTransactionCount(wallet.address), value: 0n
            };

            if (fbProvider && CHAIN.chainId === 1) {
                await fbProvider.sendBundle([{ signedTransaction: await wallet.signTransaction(tx) }], (await provider.getBlockNumber()) + 1);
            } else {
                const signedTx = await wallet.signTransaction(tx);
                await axios.post(CHAIN.rpc, { jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signedTx] }, { timeout: 2000 }).catch(() => {});
            }
        } else {
            // SILENT REJECTION: Save gas by not sending unprofitable transactions
            process.stdout.write(`${TXT.dim}.${TXT.reset}`);
        }
    } catch (e) {}
}
