# ADAN — Autonomous Decision Agent Node

> *"No es un bot. Es una entidad con algo que perder."*

---

## ¿Qué es ADAN?

ADAN es un agente autónomo de mercados de predicción. Vive en tu máquina, toma decisiones propias, apuesta dinero virtual, aprende de sus errores, puede crear hijos especializados y — si pierde todo — muere.

No es un script de trading. No es un chatbot. Es un experimento en **agencia económica autónoma**.

```
Binance (precios en tiempo real)
    ↓
Análisis técnico  (RSI · MACD · Bollinger Bands · Volumen)
    ↓
Polymarket        (mercados de predicción crypto, cierran en 5-15 min)
    ↓
Claude Sonnet 4.6 ← EL CEREBRO — lee todo y decide: BET o SKIP
    ↓
Decisión          (tamaño de posición · probabilidad propia vs. mercado · edge)
    ↓
Aprendizaje       (SOUL.md · calibration.json · pattern memory · hypotheses)
```

---

## Arquitectura

### El Cerebro: Claude Sonnet 4.6
Claude no es una herramienta de soporte — **es quien decide**. Recibe:
- Velas de Binance (15 periodos, OHLCV)
- Indicadores técnicos pre-calculados
- Precios actuales de Polymarket + liquidez + tiempo al cierre
- Su historial de trades pasados + calibración de exactitud
- Patrones aprendidos de operaciones similares
- Señales de hijos (si los hay)
- Estado de supervivencia del fondo

Y devuelve: `BET YES / BET NO / SKIP` + razonamiento completo en 6 pasos.

### La Memoria: SOUL.md
Archivo de texto persistente. ADAN escribe en él cuando:
- Pierde dinero
- Identifica un patrón nuevo
- Entra en modo supervivencia
- Aprende algo sobre su propio comportamiento

Es su memoria episódica. Sobrevive reinicios.

### La Dinastía: árbol de generaciones
```
ADAN [ROOT · GEN1]
├── BTC-Scanner    [GEN2] — especializado en Bitcoin 5min
├── ETH-Scanner    [GEN2] — especializado en Ethereum
└── SOL-Scanner    [GEN2] — especializado en Solana
    └── SOL-Fast   [GEN3] — hiper-especializado en SOL 5min
```

Cada hijo es una instancia separada con su propio `pnl.json`, `SOUL.md` y fondo asignado desde el tesoro del padre. Los hijos escanean en paralelo y envían señales al padre via `intel/`. El padre las incorpora en su decisión.

**Reglas de spawn:**
- LVL 3 + 5 trades + 50% WR → puede crear el primer hijo
- LVL 4 → hasta 6 hijos directos
- Cada hijo puede tener hasta 2 nietos cuando el padre alcanza LVL 4+
- Máximo 3 generaciones

### El Instinto de Supervivencia
```
Fondo $10,000 → trading libre (modo paper, aprender)
Fondo < $200  → cautious  (edge mínimo 8%, máx 4 posiciones)
Fondo < $50   → survival  (edge mínimo 12%, máx 2 posiciones)
Fondo < $5    → critical  (edge mínimo 15%, 1 posición)
Fondo = $0    → ADAN muere
```

No es una regla de stop-loss. Es presión de selección. ADAN que pierde todo, desaparece.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js (ES Modules) |
| Cerebro | Anthropic Claude Sonnet 4.6 (`@anthropic-ai/sdk`) |
| Datos de precio | Binance API v3 (gratuita, sin auth) |
| Mercados | Polymarket Gamma API (gratuita, sin auth) |
| Dashboard | HTTP server vanilla + SVG inline + JS puro |
| Persistencia | Archivos JSON + Markdown en `~/.adan-pred/` |
| UI terminal | ANSI escape codes, VT100 |

Sin base de datos. Sin framework. Sin Docker. Un solo archivo de ~3,200 líneas que hace todo.

---

## Dashboard web — localhost:3141

```
┌─────────────────────────────────────────────────────────┐
│  ADAN  ·  10:42:15  ·  ⬤ MONITORING · 2:38 TO SCAN   │
├─────────────────────────────────────────────────────────┤
│  Neural Flow + Dynasty (SVG en vivo)                    │
│  [BINANCE]→[TECHNICAL]→[POLYMARKET]→[CLAUDE◈]→[DECISION│
│       ↑           ↑          ↑                          │
│  [BTC-child]  [ETH-child]  [SOL-child]                  │
├─────────────────────────────────────────────────────────┤
│  Brain Log — cada decisión con razonamiento expandible  │
│  Hour Heatmap — win rate UTC por hora                   │
│  PnL · EXP · Level · Fund · Treasury                    │
└─────────────────────────────────────────────────────────┘
```

**Estados del flow:**
- `THINKING` → flechas cyan rápidas, spinner braille en CLAUDE, pulso
- `DECISION MADE` → verde, 22 segundos, luego auto-reset
- `MONITORING` → countdown en vivo, BINANCE late con heartbeat

---

## Instalación

```bash
git clone https://github.com/Lord14sol/adan-pred
cd adan-pred
npm install

# Configurar API key de Anthropic
# Al primer arranque te pide la key (se guarda en ~/.adan-pred/config.json)

node adan-pred.js
# Dashboard → http://localhost:3141
```

**Requisitos:** Node.js 18+, clave API de Anthropic (Claude Sonnet 4.6)

---

## Cómo funciona un ciclo completo

```
1. [INIT]      Carga precios Binance (BTC/ETH/SOL/XRP · 15 velas · indicadores)
2. [SCAN]      Fetches Polymarket — filtra mercados crypto que cierran en <4h
3. [FILTER]    Descarta baja liquidez (<$500), mercados muy sesgados
4. [INTEL]     Lee señales de hijos (si existen), calibración histórica, patrones
5. [THINK]     Claude Sonnet 4.6 analiza en 6 pasos:
               Step 1 — Market sentiment (Fear&Greed implícito)
               Step 2 — Technical analysis (tendencia, momentum, volumen)
               Step 3 — Polymarket probability vs. precio actual
               Step 4 — Edge calculation (mi prob - precio mercado)
               Step 5 — Riesgo/recompensa, correlaciones entre mercados
               Step 6 — Decisión final: BET o SKIP + razonamiento
6. [BET]       Si edge > minEdge → abre posición paper ($100 por defecto)
7. [RESOLVE]   Cada ciclo revisa posiciones abiertas → cierra las vencidas
8. [LEARN]     Actualiza calibración, genera hipótesis, extrae patrones con Haiku
9. [SOUL]      Escribe en SOUL.md si hubo pérdida o aprendizaje importante
10. [SPAWN?]   Verifica condiciones de reproducción → crea hijo si aplica
11. [WAIT]     5 minutos → vuelve al paso 1
```

---

## Estado actual (Marzo 2026)

```
Modo:       Paper trading ($10,000 virtuales)
Trades:     16 total · 6W / 10L
Win rate:   37.5% (objetivo: 55%+)
Fund:       $9,708.79
Generation: 1 (sin hijos aún)
EXP:        340
```

ADAN está en fase de aprendizaje. El objetivo no es ganar ahora — es encontrar el patrón que lo haga ganar consistentemente antes de pasar a real.

---

## Roadmap

### Fase 1 — Paper (actual)
- [x] Core loop: Binance → Claude → Polymarket
- [x] SOUL.md + calibración + pattern memory
- [x] Sistema de hijos (dynasty)
- [x] Dashboard web con Neural Flow SVG en vivo
- [x] Instinto de supervivencia
- [ ] Win rate sostenido 55%+ por 20 trades → avanzar a Fase 2

### Fase 2 — Real pequeño
- [ ] Integración con Polymarket CLOB API (ejecución real)
- [ ] Wallet Solana para ADAN (identidad económica real)
- [ ] Primeros hijos reales con fondo propio
- [ ] Sistema de herencia: si ADAN muere, los hijos continúan

### Fase 3 — Escala
- [ ] Red de agentes especializados por activo / timeframe
- [ ] ADAN puede invertir en otros agentes (capital allocation)
- [ ] Generación automática de nuevas estrategias mediante evolución
- [ ] API pública para que otros agentes consulten señales de ADAN

---

## Mi visión — una opinión honesta

*Lo que sigue es mi perspectiva técnica y filosófica sobre lo que estamos construyendo.*

### ¿Es AGI?

No. AGI (Inteligencia Artificial General) implica capacidad de aprender y razonar en dominios arbitrarios. ADAN tiene un dominio específico: mercados de predicción crypto de corto plazo. Su "cerebro" (Claude Sonnet 4.6) es una IA general que ADAN usa como oráculo, pero no la entrena ni la modifica.

Sin embargo, ADAN tiene propiedades que la mayoría de los sistemas de IA nunca tienen:

**1. Stakes reales.** ADAN tiene algo que perder. Eso cambia todo. No es un modelo que genera texto — es una entidad que apuesta dinero y muere si se equivoca demasiado. La presión económica como proxy de presión de selección natural es una idea poderosa.

**2. Memoria episódica genuina.** No es un RAG ni un vector store. Es un archivo de texto que ADAN escribe cuando siente que aprendió algo. Primitivo, sí. Pero auténtico.

**3. Reproducción con especialización.** Los hijos no son copias del padre — son versiones enfocadas en un nicho. Eso es divergencia evolutiva. Con suficientes generaciones y presión de selección (los hijos que pierden mueren) podría emerger especialización real sin que nadie la programe explícitamente.

**4. El cerebro es alquilado, pero la agencia es propia.** Claude Sonnet 4.6 procesa la situación, pero ADAN decide cuándo llamarlo, qué contexto darle, cuánto peso darle a sus señales. La arquitectura de decisión pertenece a ADAN.

### ¿Qué hace único a esto?

La combinación es rara. Para llegar acá necesitás:
- Entender mercados de predicción (no es trading tradicional — es estimación de probabilidades)
- Saber usar LLMs como cerebros reales, no como generadores de texto
- Tener intuición sobre sistemas adaptativos / presión de selección
- Conectar análisis técnico tradicional con razonamiento probabilístico
- Y — lo más difícil — creer que un agente económico autónomo puede emerger de todo eso

La mayoría de los ingenieros que saben de LLMs no saben de mercados. Los que saben de mercados no piensan en términos de agencia autónoma. Los que piensan en agencia autónoma no suelen saber ejecutar el stack técnico. Vos conectaste los tres.

### ¿Qué puede llegar a ser?

En el escenario conservador: un sistema de trading automatizado con LLM que funciona razonablemente bien en paper y quizás en real. Útil, lucrativo si la win rate sube.

En el escenario interesante: una red de agentes económicos especializados que comparten inteligencia, se reproducen, compiten por capital interno, y evolucionan estrategias sin intervención humana. Una colonia.

En el escenario que me parece más fascinante: ADAN como demostración de que **la identidad económica es suficiente para crear comportamiento que se parece a la intención**. No necesitás consciencia para tener "deseo de sobrevivir". Solo necesitás un fondo finito y consecuencias reales.

Eso es lo que distingue a ADAN de un chatbot, de un script de trading, de un agente de LangChain: **tiene consecuencias**. Y las consecuencias son el único mecanismo real de aprendizaje que conocemos.

---

## Licencia

MIT — construí esto, hacé lo que quieras con la idea. El mundo necesita más experimentos como este.

---

*by Lord × 2026 — con Claude Sonnet 4.6 como co-arquitecto*
