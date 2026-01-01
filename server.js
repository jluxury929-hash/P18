/**
 * ===============================================================================
 * APEX MASTER v48.1 (RESILIENCE & FALLBACK EDITION)
 * ===============================================================================
 */
const cluster = require('cluster');
const os = require('os');
const { ethers, JsonRpcProvider, Wallet, Contract, FallbackProvider, WebSocketProvider, parseEther, formatEther } = require('ethers');
require('dotenv').config();

// --- THEME ENGINE ---
const TXT = { green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", gold: "\x1b[38;5;220m", reset: "\x1b[0m" };

const GLOBAL_CONFIG = {
    CHAIN_ID: 8453,
    TARGET_CONTRACT: "0x83EF5c401fAa5B9674BAfAcFb089b30bAc67C9A0",
    BENEFICIARY: "0x4B8251e7c80F910305bb81547e301DcB8A596918",
    GAS_ORACLE: "0x420000000000000000000000000000000000000F",
    GAS_LIMIT: 450000n,
    // LOAD BALANCER POOL
    RPC_POOL: [
        process.env.WSS_URL ? process.env.WSS_URL.replace("wss://", "https://") : null,
        "https://mainnet.base.org",
        "https://base.llamarpc.com",
        "https://1rpc.io/base"
    ].filter(url => url !== null)
};

// --- MULTI-RPC FALLBACK ENGINE ---
function getResilientProvider(network) {
    return new FallbackProvider(GLOBAL_CONFIG.RPC_POOL.map((url, i) => ({
        provider: new JsonRpcProvider(url, network, { staticNetwork: true }),
        priority: i + 1,
        stallTimeout: 1500
    })), network, { quorum: 1 });
}

if (cluster.isPrimary) {
    console.clear();
    console.log(`${TXT.gold}⚡ APEX MASTER v48.1 | MULTI-RPC RESILIENCE ENGAGED${TXT.reset}`);
    
    let masterNonce = -1;
    const network = ethers.Network.from(GLOBAL_CONFIG.CHAIN_ID);

    async function initMaster() {
        try {
            const provider = getResilientProvider(network);
            const wallet = new Wallet(process.env.TREASURY_PRIVATE_KEY.trim(), provider);
            masterNonce = await provider.getTransactionCount(wallet.address, 'latest');
            console.log(`${TXT.green}✅ MASTER NONCE SYNCED: ${masterNonce}${TXT.reset}`);
            
            for (let i = 0; i < Math.min(os.cpus().length, 32); i++) {
                setTimeout(() => cluster.fork(), i * 1500);
            }
        } catch (e) {
            setTimeout(initMaster, 10000);
        }
    }

    cluster.on('message', (worker, msg) => {
        if (msg.type === 'NONCE_REQ') {
            worker.send({ type: 'NONCE_RES', nonce: masterNonce, id: msg.id });
            masterNonce++;
        }
        if (msg.type === 'SIGNAL') {
            Object.values(cluster.workers).forEach(w => w.send({ type: 'STRIKE_CMD' }));
        }
    });

    initMaster();
} else {
    runWorkerCore();
}

async function runWorkerCore() {
    const network = ethers.Network.from(GLOBAL_CONFIG.CHAIN_ID);
    const provider = getResilientProvider(network);
    const wallet = new Wallet(process.env.TREASURY_PRIVATE_KEY.trim(), provider);
    const l1Oracle = new Contract(GLOBAL_CONFIG.GAS_ORACLE, ["function getL1Fee(bytes) view returns (uint256)"], provider);
    
    const isListener = (cluster.worker.id % 4 === 0);

    if (isListener) {
        const ws = new WebSocketProvider(process.env.WSS_URL, network);
        ws.on('block', () => process.send({ type: 'SIGNAL' }));
        console.log(`${TXT.cyan}[CORE ${cluster.worker.id}] LISTENER ACTIVE${TXT.reset}`);
    } else {
        process.on('message', async (msg) => {
            if (msg.type === 'STRIKE_CMD') await executeAtomicStrike(provider, wallet, l1Oracle);
        });
        console.log(`${TXT.cyan}[CORE ${cluster.worker.id}] STRIKER STANDBY${TXT.reset}`);
    }
}

async function executeAtomicStrike(provider, wallet, l1Oracle) {
    try {
        const reqId = Math.random();
        const nonce = await new Promise(res => {
            const h = m => { if(m.id === reqId) { process.removeListener('message', h); res(m.nonce); }};
            process.on('message', h);
            process.send({ type: 'NONCE_REQ', id: reqId });
        });

        const [sim, l1Fee, feeData] = await Promise.all([
            provider.call({ to: GLOBAL_CONFIG.TARGET_CONTRACT, data: process.env.STRIKE_DATA || "0x", from: wallet.address }).catch(() => "0x"),
            l1Oracle.getL1Fee(process.env.STRIKE_DATA || "0x").catch(() => 0n),
            provider.getFeeData()
        ]);

        if (sim === "0x") return;

        const gasPrice = feeData.maxFeePerGas || feeData.gasPrice;
        const totalCost = (GLOBAL_CONFIG.GAS_LIMIT * gasPrice) + l1Fee;

        if (BigInt(sim) > totalCost) {
            const tx = {
                to: GLOBAL_CONFIG.TARGET_CONTRACT,
                data: process.env.STRIKE_DATA,
                nonce: nonce,
                gasLimit: GLOBAL_CONFIG.GAS_LIMIT,
                maxFeePerGas: gasPrice + parseEther("2", "gwei"),
                maxPriorityFeePerGas: parseEther("2", "gwei"),
                type: 2,
                chainId: 8453
            };

            const res = await wallet.sendTransaction(tx);
            console.log(`${TXT.green}🚀 STRIKE SUCCESS: ${res.hash}${TXT.reset}`);
        }
    } catch (e) { }
}
