/**
 * ===============================================================================
 * APEX MASTER v48.3 (SHADOW PROTOCOL) - BOOT-LOOP REPAIR BUILD
 * ===============================================================================
 * FIX: COLD-START RPC ROTATION | MASTER BOOTSTRAP RECOVERY
 * DNA: SEQUENTIAL HYDRATION + 429 HANDSHAKE GUARD + MULTI-RPC FALLBACK
 * ===============================================================================
 */
const cluster = require('cluster');
const os = require('os');
const { ethers, JsonRpcProvider, Wallet, Contract, FallbackProvider, WebSocketProvider, parseEther } = require('ethers');
require('dotenv').config();

// --- ROOT SAFETY: PREVENTS CONTAINER CRASH FROM RPC REJECTION ---
process.on('uncaughtException', (err) => {
    const msg = err.message || "";
    if (msg.includes('429') || msg.includes('32005') || msg.includes('coalesce') || msg.includes('Too Many Requests')) return;
    console.error("\x1b[31m[CRITICAL ROOT ERROR]\x1b[0m", msg);
});

const TXT = { green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", gold: "\x1b[38;5;220m", reset: "\x1b[0m", red: "\x1b[31m" };

const GLOBAL_CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    BENEFICIARY: "0x4B8251e7c80F910305bb81547e301DcB8A596918",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    GAS_LIMIT: 450000n,
    // LOAD BALANCER POOL (v48.3: Now used by Master for Cold-Start)
    RPC_POOL: [
        "https://base.merkle.io", 
        "https://1rpc.io/base",
        "https://mainnet.base.org",
        "https://base.llamarpc.com",
        "https://base-mainnet.public.blastapi.io"
    ]
};

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.gold}╔════════════════════════════════════════════════════════╗`);
    console.log(`║   ⚡ APEX MASTER v48.3 | SHADOW RECOVERY ENGAGED     ║`);
    console.log(`║   DNA: COLD-START ROTATION + MASTER AUTO-RECOVERY   ║`);
    console.log(`╚════════════════════════════════════════════════════════╝${TXT.reset}\n`);

    let masterNonce = -1;
    const network = ethers.Network.from(GLOBAL_CONFIG.CHAIN_ID);

    async function initMaster() {
        // v48.3: Cold-Start Rotation Loop
        for (const url of GLOBAL_CONFIG.RPC_POOL) {
            try {
                console.log(`${TXT.cyan}📡 Attempting Bootstrap via: ${new URL(url).hostname}...${TXT.reset}`);
                const provider = new JsonRpcProvider(url, network, { staticNetwork: true });
                const wallet = new Wallet(process.env.TREASURY_PRIVATE_KEY.trim(), provider);
                
                // Test connection with a simple call
                masterNonce = await provider.getTransactionCount(wallet.address, 'latest');
                
                console.log(`${TXT.green}✅ BOOTSTRAP SUCCESSFUL VIA ${new URL(url).hostname}${TXT.reset}`);
                console.log(`${TXT.green}✅ MASTER NONCE SYNCED: ${masterNonce}${TXT.reset}`);
                
                // Start sequential hydration only after successful bootstrap
                const cpuCount = Math.min(os.cpus().length, 32);
                for (let i = 0; i < cpuCount; i++) {
                    await new Promise(r => setTimeout(r, 2500)); 
                    cluster.fork();
                }
                return; // Exit boot loop on success
            } catch (e) {
                console.log(`${TXT.red}❌ RPC NODE REJECTED MASTER: ${new URL(url).hostname}${TXT.reset}`);
            }
        }
        
        console.log(`${TXT.yellow}⚠️ ALL RPC NODES EXHAUSTED. SYSTEM COOL-DOWN: 30S...${TXT.reset}`);
        setTimeout(initMaster, 30000);
    }

    cluster.on('message', (worker, msg) => {
        if (msg.type === 'NONCE_REQ') {
            worker.send({ type: 'NONCE_RES', nonce: masterNonce, id: msg.id });
            masterNonce++;
        }
        if (msg.type === 'SIGNAL') {
            Object.values(cluster.workers).forEach(w => {
                if (w && w.isConnected()) w.send({ type: 'STRIKE_CMD' });
            });
        }
    });

    initMaster();
} else {
    // --- WORKER CORE ---
    runWorkerCore();
}

async function runWorkerCore() {
    const network = ethers.Network.from(GLOBAL_CONFIG.CHAIN_ID);
    // Multi-RPC Fallback to prevent mid-operation 429 crashes
    const provider = new FallbackProvider(GLOBAL_CONFIG.RPC_POOL.map((url, i) => ({
        provider: new JsonRpcProvider(url, network, { staticNetwork: true }),
        priority: i + 1, stallTimeout: 1200
    })), network, { quorum: 1 });

    const wallet = new Wallet(process.env.TREASURY_PRIVATE_KEY.trim(), provider);
    const l1Oracle = new Contract(GLOBAL_CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
    
    const isListener = (cluster.worker.id % 4 === 0);
    const TAG = `${TXT.cyan}[CORE ${cluster.worker.id}]${TXT.reset}`;

    if (isListener) {
        async function connectWs() {
            try {
                const ws = new WebSocketProvider(process.env.WSS_URL, network);
                ws.on('error', () => {}); 
                ws.on('block', () => process.send({ type: 'SIGNAL' }));
                console.log(`${TAG} Listener Engaged.`);
            } catch (e) {
                setTimeout(connectWs, 20000);
            }
        }
        connectWs();
    } else {
        process.on('message', async (msg) => {
            if (msg.type === 'STRIKE_CMD') await executeAtomicStrike(provider, wallet, l1Oracle, TAG);
        });
    }
}

async function executeAtomicStrike(provider, wallet, l1Oracle, TAG) {
    try {
        const reqId = Math.random();
        const nonce = await new Promise((res, rej) => {
            const timeout = setTimeout(() => rej("Timeout"), 2000);
            const h = m => { if(m.id === reqId) { clearTimeout(timeout); process.removeListener('message', h); res(m.nonce); }};
            process.on('message', h);
            process.send({ type: 'NONCE_REQ', id: reqId });
        });

        const data = process.env.STRIKE_DATA || "0x";
        const [sim, l1Fee, feeData] = await Promise.all([
            provider.call({ to: GLOBAL_CONFIG.TARGET_CONTRACT, data, from: wallet.address }).catch(() => "0x"),
            l1Oracle.getL1Fee(data).catch(() => 0n),
            provider.getFeeData()
        ]);

        if (sim === "0x") return;

        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
        if (BigInt(sim) > (GLOBAL_CONFIG.GAS_LIMIT * gasPrice) + l1Fee) {
            const tx = { to: GLOBAL_CONFIG.TARGET_CONTRACT, data, nonce, gasLimit: GLOBAL_CONFIG.GAS_LIMIT, maxFeePerGas: gasPrice + parseEther("2", "gwei"), maxPriorityFeePerGas: parseEther("2", "gwei"), type: 2, chainId: 8453 };
            const res = await wallet.sendTransaction(tx);
            console.log(`${TAG} 🚀 STRIKE SUCCESS: ${res.hash.substring(0, 15)}...`);
        }
    } catch (e) { }
}
