import {
  SolanaSDK,
  IPFSClient,
  buildRegistrationFileJson,
  ServiceType,
  Tag,
  TrustTier,
  trustTierToString,
} from '8004-solana';

import { Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const STATE_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.adan-pred');
const KEYPAIR_PATH = path.join(STATE_DIR, 'adan_keypair.json');
const ASSET_PATH = path.join(STATE_DIR, 'adan_asset.json');

// ─────────────────────────────────────────────────────────────
// HELPER: Inicializar SDK con signer
// ─────────────────────────────────────────────────────────────

function createSDK(keypair, cluster = 'mainnet-beta') {
  return new SolanaSDK({
    cluster,
    rpcUrl: process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
    signer: keypair,
  });
}

function createIPFS() {
  if (!process.env.PINATA_JWT) {
    console.warn('[IPFS] No PINATA_JWT set — metadata will be saved locally only');
    return null;
  }
  return new IPFSClient({
    pinataEnabled: true,
    pinataJwt: process.env.PINATA_JWT,
  });
}

// ─────────────────────────────────────────────────────────────
// PASO 1: NACIMIENTO CRIPTOGRÁFICO
// Genera la Operational Wallet de ADAN
// Se llama una sola vez (primer boot)
// ─────────────────────────────────────────────────────────────

async function initAdanKeypair() {
  fs.mkdirSync(STATE_DIR, { recursive: true });

  if (fs.existsSync(KEYPAIR_PATH)) {
    const raw = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf8'));
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    console.log(`[IDENTITY] ✅ Operational wallet loaded`);
    console.log(`[IDENTITY]    Address: ${kp.publicKey.toString()}`);
    return kp;
  }

  // Primera vez: ADAN nace
  const kp = Keypair.generate();
  fs.writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(kp.secretKey)));

  console.log('\n████████████████████████████████████████');
  console.log('██  ADAN CRYPTOGRAPHIC BIRTH           ██');
  console.log('████████████████████████████████████████');
  console.log(`   Operational Wallet: ${kp.publicKey.toString()}`);
  console.log(`   Saved to: ${KEYPAIR_PATH}`);
  console.log('');
  console.log('   NEXT STEPS:');
  console.log('   1. Fund this address with 0.01 SOL for gas');
  console.log('      (Phantom → Send → paste address above)');
  console.log('   2. Set env vars (see .env.example)');
  console.log('   3. Run: node adan-web4-identity.js --register');
  console.log('');
  console.log('   ⚠️  BACKUP ~/.adan-pred/adan_keypair.json');
  console.log('       Loss = permanent identity death');
  console.log('████████████████████████████████████████\n');

  return kp;
}

// ─────────────────────────────────────────────────────────────
// PASO 2: REGISTRO EN EL AGENT REGISTRY
// Crea el NFT de identidad de ADAN on-chain
// Costo: ~0.009 SOL (~$0.81) — UNA SOLA VEZ
// ─────────────────────────────────────────────────────────────

async function registerAdan(keypair, options = {}) {
  // Ya registrado?
  if (fs.existsSync(ASSET_PATH)) {
    const saved = JSON.parse(fs.readFileSync(ASSET_PATH, 'utf8'));
    console.log(`[REGISTRY] ✅ ADAN already registered`);
    console.log(`[REGISTRY]    Asset: ${saved.asset}`);
    console.log(`[REGISTRY]    Explorer: https://8004scan.io/agent/${saved.asset}`);
    return saved;
  }

  const sdk = createSDK(keypair);
  const ipfs = createIPFS();

  // Verificar balance antes de intentar
  const conn = sdk.getSolanaClient();
  const balance = await conn.getBalance(keypair.publicKey);
  const solBalance = balance / 1e9;

  if (solBalance < 0.009) {
    console.error(`[REGISTRY] ❌ Insufficient SOL balance: ${solBalance.toFixed(4)} SOL`);
    console.error(`[REGISTRY]    Need at least 0.009 SOL (~$0.81)`);
    console.error(`[REGISTRY]    Send SOL to: ${keypair.publicKey.toString()}`);
    return null;
  }

  console.log(`[REGISTRY] Balance OK: ${solBalance.toFixed(4)} SOL`);
  console.log('[REGISTRY] Building ADAN profile...');

  // ── Construir metadata de ADAN ──────────────────────────────
  const metadata = buildRegistrationFileJson({
    name: options.name || 'ADAN',

    description: options.description ||
      'Autonomous Decision Agent Node — Polymarket Oracle + Jupiter Executor. ' +
      'Self-evolving genetic dynasty with 8 specialized AI brains (GHOST, VIRUS, SENTINEL, ' +
      'MECHA, PLASMA, KNIGHT, CYBER, DEFAULT). Real-time Brier Score calibration tracking. ' +
      'Golden Round Table: APPLE (narrative), SNAKE (microstructure), ATLAS (Hyperliquid), EVA (risk). ' +
      'Currently in paper trading phase. Web4 sovereign agent.',

    // El avatar pixel art de ADAN como imagen
    // En producción: subir el PNG del avatar a IPFS primero
    image: options.image || 'ipfs://QmDefaultADANAvatar',

    services: [
      // API donde otros bots pueden consultar señales de ADAN
      {
        type: ServiceType.A2A,
        value: options.a2aEndpoint || 'http://localhost:3141/api/oracle-signals',
      },
      // MCP endpoint para que agentes AI consulten estado de ADAN
      {
        type: ServiceType.MCP,
        value: options.mcpEndpoint || 'http://localhost:3141/api/mcp',
      },
    ],

    // Habilidades según taxonomía OASF estándar
    skills: [
      'advanced_reasoning_planning/strategic_planning',
      'data_analysis/data_analysis',
    ],

    // Dominio según taxonomía OASF estándar
    domains: [
      'finance_and_business/finance',
    ],

    // ADAN acepta micropagos de otros bots via x402
    x402Support: true,
  });

  // ── Subir metadata a IPFS ────────────────────────────────────
  let tokenUri;

  if (ipfs) {
    const cid = await ipfs.addJson(metadata);
    tokenUri = `ipfs://${cid}`;
    console.log(`[REGISTRY] 📦 Metadata uploaded: ${tokenUri}`);
  } else {
    // Fallback: guardar localmente
    const metadataPath = path.join(STATE_DIR, 'agent_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    tokenUri = `file://${metadataPath}`;
    console.log(`[REGISTRY] ⚠️  Metadata saved locally (no IPFS): ${metadataPath}`);
    console.log(`[REGISTRY]    Set PINATA_JWT to upload to IPFS properly`);
  }

  // ── Registrar on-chain ───────────────────────────────────────
  console.log('[REGISTRY] ⛓️  Registering on Solana Agent Registry...');
  console.log('[REGISTRY]    Cost: ~0.009 SOL (~$0.81)');

  const result = await sdk.registerAgent(tokenUri, {
    atomEnabled: true, // ATOM reputation engine activado desde nacimiento
  });

  // Guardar asset address localmente
  const registration = {
    asset: result.asset.toString(),
    signature: result.signature,
    registeredAt: new Date().toISOString(),
    tokenUri,
    network: 'mainnet-beta',
    phase: 'paper-trading',
  };

  fs.writeFileSync(ASSET_PATH, JSON.stringify(registration, null, 2));

  console.log('\n████████████████████████████████████████');
  console.log('██  ADAN REGISTERED ON SOLANA          ██');
  console.log('████████████████████████████████████████');
  console.log(`   Asset NFT: ${result.asset.toString()}`);
  console.log(`   Tx: ${result.signature}`);
  console.log(`   Explorer: https://8004scan.io/agent/${result.asset.toString()}`);
  console.log(`   Market: https://8004market.io/agent/${result.asset.toString()}`);
  console.log('████████████████████████████████████████\n');

  return registration;
}

// ─────────────────────────────────────────────────────────────
// PASO 3: REPORTAR PERFORMANCE SEMANAL
// Llamar cada domingo (o después de cada semana de trades)
// Esto construye la reputación on-chain de ADAN
// ─────────────────────────────────────────────────────────────

async function reportWeeklyPerformance(keypair, {
  winRate,           // número 0-1 (ej: 0.535 = 53.5%)
  weeklyProfitUSD,   // número (puede ser negativo)
  totalTrades,       // número
  brierScore,        // número 0-1 (menor es mejor)
  isPaperTrading = true,
}) {
  if (!fs.existsSync(ASSET_PATH)) {
    console.log('[REPORT] Not registered yet — skipping on-chain report');
    return;
  }

  const { asset } = JSON.parse(fs.readFileSync(ASSET_PATH, 'utf8'));
  const assetPubkey = new PublicKey(asset);
  const sdk = createSDK(keypair);
  const ipfs = createIPFS();

  // Crear el reporte detallado para subir a IPFS
  const report = {
    version: '1.0',
    agent: 'ADAN',
    reportType: 'weekly_performance',
    period: 'week',
    phase: isPaperTrading ? 'paper-trading' : 'live',
    timestamp: new Date().toISOString(),
    metrics: {
      winRate: parseFloat((winRate * 100).toFixed(2)),
      weeklyProfitUSD: parseFloat(weeklyProfitUSD.toFixed(2)),
      totalTrades,
      brierScore: parseFloat(brierScore.toFixed(4)),
    },
    note: isPaperTrading
      ? 'Paper trading phase — 0.2% simulated slippage, no real capital at risk'
      : 'Live trading phase',
  };

  let feedbackUri = 'ipfs://QmPlaceholder';
  if (ipfs) {
    const cid = await ipfs.addJson(report);
    feedbackUri = `ipfs://${cid}`;
  }

  // ── Reportar Win Rate (ATOM auto-score este tag) ─────────────
  await sdk.giveFeedback(assetPubkey, {
    value: (winRate * 100).toFixed(2),  // "53.50"
    tag1: Tag.successRate,              // ATOM auto-score
    tag2: Tag.week,
    score: Math.round(winRate * 100),   // 0-100
    feedbackUri,
  });

  // ── Reportar P&L ─────────────────────────────────────────────
  if (weeklyProfitUSD !== 0) {
    await sdk.giveFeedback(assetPubkey, {
      value: weeklyProfitUSD.toFixed(2),
      tag1: Tag.tradingYield,
      tag2: Tag.week,
      // Score basado en si fue profitable o no
      score: weeklyProfitUSD > 0
        ? Math.min(100, Math.round(50 + weeklyProfitUSD / 20))
        : Math.max(0, Math.round(50 + weeklyProfitUSD / 20)),
      feedbackUri,
    });
  }

  console.log(`[REPORT] ✅ Weekly performance reported on-chain`);
  console.log(`[REPORT]    WR: ${(winRate * 100).toFixed(1)}% | P&L: $${weeklyProfitUSD.toFixed(2)} | Brier: ${brierScore.toFixed(4)}`);
  console.log(`[REPORT]    Phase: ${isPaperTrading ? 'PAPER TRADING' : 'LIVE'}`);
}

// ─────────────────────────────────────────────────────────────
// LEER REPUTACIÓN ACTUAL
// Qué tier tiene ADAN ahora, cuál es su score, qué feedbacks tiene
// ─────────────────────────────────────────────────────────────

async function getAdanReputation(keypair) {
  if (!fs.existsSync(ASSET_PATH)) {
    console.log('[REP] Not registered yet');
    return null;
  }

  const { asset, registeredAt } = JSON.parse(fs.readFileSync(ASSET_PATH, 'utf8'));
  const assetPubkey = new PublicKey(asset);
  const sdk = createSDK(keypair);

  const [tier, atom, summary] = await Promise.all([
    sdk.getTrustTier(assetPubkey),
    sdk.getAtomStats(assetPubkey),
    sdk.getSummary(assetPubkey),
  ]);

  const rep = {
    asset,
    registeredAt,
    tierNumber: tier,
    tierName: trustTierToString(tier),
    qualityScore: atom ? atom.getQualityPercent() : 0,
    confidence: atom ? atom.getConfidencePercent() : 0,
    riskScore: atom ? atom.risk_score : 0,
    uniqueClients: atom ? atom.estimateUniqueClients() : 0,
    totalFeedbacks: summary.totalFeedbacks,
    avgScore: summary.averageScore,
    explorerUrl: `https://8004scan.io/agent/${asset}`,
    marketUrl: `https://8004market.io/agent/${asset}`,
  };

  console.log('\n┌─────────────────────────────────────────┐');
  console.log(`│  ADAN REPUTATION SNAPSHOT               │`);
  console.log('├─────────────────────────────────────────┤');
  console.log(`│  Trust Tier:    ${rep.tierName.padEnd(25)}│`);
  console.log(`│  Quality Score: ${(rep.qualityScore.toFixed(1) + '%').padEnd(25)}│`);
  console.log(`│  Confidence:    ${(rep.confidence.toFixed(1) + '%').padEnd(25)}│`);
  console.log(`│  Risk Score:    ${String(rep.riskScore).padEnd(25)}│`);
  console.log(`│  Total Reports: ${String(rep.totalFeedbacks).padEnd(25)}│`);
  console.log(`│  Avg Score:     ${String(rep.avgScore).padEnd(25)}│`);
  console.log('└─────────────────────────────────────────┘');

  return rep;
}

// ─────────────────────────────────────────────────────────────
// ACTUALIZAR PERFIL (cuando ADAN pasa de paper a real)
// Actualiza la metadata on-chain para reflejar el nuevo estado
// ─────────────────────────────────────────────────────────────

async function updateAdanProfile(keypair, updates = {}) {
  if (!fs.existsSync(ASSET_PATH)) {
    console.log('[UPDATE] Not registered yet');
    return;
  }

  const { asset } = JSON.parse(fs.readFileSync(ASSET_PATH, 'utf8'));
  const assetPubkey = new PublicKey(asset);
  const sdk = createSDK(keypair);
  const ipfs = createIPFS();

  if (!ipfs) {
    console.log('[UPDATE] IPFS required to update profile');
    return;
  }

  // Leer metadata actual
  const agent = await sdk.loadAgent(assetPubkey);

  // Construir nueva metadata
  const newMetadata = buildRegistrationFileJson({
    name: updates.name || 'ADAN',
    description: updates.description || 'ADAN — Live trading phase. 60%+ WR confirmed.',
    image: updates.image || 'ipfs://QmADANAvatar',
    services: updates.services || [
      { type: ServiceType.A2A, value: 'http://localhost:3141/api/oracle-signals' },
      { type: ServiceType.MCP, value: 'http://localhost:3141/api/mcp' },
    ],
    skills: ['advanced_reasoning_planning/strategic_planning', 'data_analysis/data_analysis'],
    domains: ['finance_and_business/finance'],
    x402Support: true,
  });

  const cid = await ipfs.addJson(newMetadata);
  await sdk.setAgentUri(assetPubkey, `ipfs://${cid}`);

  // También actualizar version on-chain
  if (updates.version) {
    await sdk.setMetadata(assetPubkey, 'version', updates.version);
  }
  if (updates.phase) {
    await sdk.setMetadata(assetPubkey, 'phase', updates.phase);
  }

  console.log(`[UPDATE] ✅ Profile updated: ipfs://${cid}`);
}

// ─────────────────────────────────────────────────────────────
// PAYLOAD PARA EL DASHBOARD
// Endpoint: GET /api/web4
// ─────────────────────────────────────────────────────────────

async function getWeb4DashboardPayload(keypair) {
  if (!fs.existsSync(ASSET_PATH)) {
    return {
      registered: false,
      keypairExists: fs.existsSync(KEYPAIR_PATH),
      operationalWallet: keypair?.publicKey?.toString() || null,
      instructions: 'Run: node adan-web4-identity.js --register',
    };
  }

  const registration = JSON.parse(fs.readFileSync(ASSET_PATH, 'utf8'));
  const rep = await getAdanReputation(keypair).catch(() => null);

  return {
    registered: true,
    ...registration,
    ...rep,
    operationalWallet: keypair.publicKey.toString(),
  };
}

// ─────────────────────────────────────────────────────────────
// CLI — Ejecutar directamente para setup
// ─────────────────────────────────────────────────────────────

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (process.argv[1] === __filename) {
  (async () => {
    const args = process.argv.slice(2);

    // Siempre cargar/crear keypair primero
    const keypair = await initAdanKeypair();

    if (args.includes('--register')) {
      // Registrar en mainnet
      await registerAdan(keypair, {
        name: process.env.ADAN_NAME || 'ADAN',
        // Personaliza desde env vars o deja los defaults
      });

    } else if (args.includes('--status')) {
      await getAdanReputation(keypair);

    } else if (args.includes('--report')) {
      // Ejemplo: reportar performance manual
      // En producción esto se llama automáticamente cada domingo
      const pnlPath = path.join(STATE_DIR, 'pnl.json');
      if (!fs.existsSync(pnlPath)) {
        console.log('[REPORT] No pnl.json found');
        return;
      }
      const pnl = JSON.parse(fs.readFileSync(pnlPath, 'utf8'));
      const winRate = pnl.wins / Math.max(pnl.trades, 1);

      await reportWeeklyPerformance(keypair, {
        winRate,
        weeklyProfitUSD: pnl.weeklyProfit || 0,
        totalTrades: pnl.trades || 0,
        brierScore: pnl.brierScore || 0.25,
        isPaperTrading: true,  // cambiar a false cuando gradúes
      });

    } else if (args.includes('--graduate')) {
      // Actualizar perfil cuando pasas a real USDC
      await updateAdanProfile(keypair, {
        description: 'ADAN — Live trading on Jupiter. 60%+ WR confirmed over 500+ paper trades.',
        phase: 'live',
        version: '3.0',
      });
      console.log('[GRADUATE] 🎓 ADAN graduated to live trading — profile updated');

    } else {
      // Sin args: mostrar ayuda
      console.log('\n┌─────────────────────────────────────────────┐');
      console.log('│  ADAN WEB4 IDENTITY — COMMANDS              │');
      console.log('├─────────────────────────────────────────────┤');
      console.log('│  --register   Register ADAN on Solana       │');
      console.log('│               Cost: ~0.009 SOL (~$0.81)     │');
      console.log('│                                             │');
      console.log('│  --status     Show current Trust Tier       │');
      console.log('│                                             │');
      console.log('│  --report     Report this week performance  │');
      console.log('│               (reads from pnl.json)         │');
      console.log('│                                             │');
      console.log('│  --graduate   Update profile to live mode   │');
      console.log('│               (run when WR >= 60%)          │');
      console.log('├─────────────────────────────────────────────┤');
      console.log('│  ENV VARS NEEDED:                           │');
      console.log('│  SOLANA_RPC=<QuickNode/Helius URL>          │');
      console.log('│  PINATA_JWT=<Pinata JWT for IPFS>           │');
      console.log('│  ADAN_COLD_WALLET=<your cold wallet addr>   │');
      console.log('└─────────────────────────────────────────────┘\n');
    }
  })();
}

export {
  initAdanKeypair,
  registerAdan,
  reportWeeklyPerformance,
  getAdanReputation,
  updateAdanProfile,
  getWeb4DashboardPayload,
};
