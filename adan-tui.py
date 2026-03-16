#!/usr/bin/env python3
"""
ADAN CONSCIOUSNESS TERMINAL v5.0
The Living Dashboard — Every neuron, every thought, every heartbeat visible.
"""
import asyncio
import json
import os
import time
import random
from datetime import datetime, timezone
from pathlib import Path

import httpx
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, ScrollableContainer
from textual.widgets import Header, Footer, Static, DataTable, Log, TabbedContent, TabPane
from textual.reactive import reactive
from textual import work

API_BASE = "http://localhost:3141"
DIR = os.path.expanduser("~/.adan-pred")
LOG_FILE = os.path.join(DIR, "adan.log")

# ── Helpers ──────────────────────────────────────────────────────────────────

def load_json(filename):
    try:
        with open(os.path.join(DIR, filename), "r") as f:
            return json.load(f)
    except Exception:
        return {}

def load_jsonl_tail(filename, n=5):
    try:
        p = os.path.join(DIR, filename)
        with open(p, "r") as f:
            lines = f.readlines()
        entries = []
        for l in lines[-n:]:
            try:
                entries.append(json.loads(l.strip()))
            except Exception:
                pass
        return entries
    except Exception:
        return []

def spark_line(values, width=30):
    if not values:
        return ""
    chars = " ▁▂▃▄▅▆▇█"
    mn, mx = min(values), max(values)
    rng = mx - mn if mx != mn else 1
    result = ""
    for v in values[-width:]:
        idx = int(((v - mn) / rng) * 8)
        idx = max(0, min(8, idx))
        color = "green" if v >= 0 else "red"
        result += f"[{color}]{chars[idx]}[/]"
    return result

def bar_gauge(value, max_val=100, width=12, color="#00ff00"):
    filled = int((value / max(max_val, 1)) * width)
    filled = max(0, min(width, filled))
    return f"[{color}]{'█' * filled}[/][#333333]{'░' * (width - filled)}[/]"

PULSE_FRAMES = ["◉", "◎", "◉", "●", "◉", "◎"]
BRAIN_FRAMES = ["🧠", "🔮", "🧠", "💭", "🧠", "⚡"]
HEARTBEAT = ["♡", "♥", "♡", "♥♥", "♡", "♥"]

# ── CSS ──────────────────────────────────────────────────────────────────────

CSS = """
Screen {
    background: #0a0a0a;
    color: #00ff00;
}

#header-bar {
    height: 1;
    background: #ff8800;
    color: #000000;
    text-style: bold;
    layout: horizontal;
}
.head-item { width: 1fr; content-align: center middle; }

#main-grid {
    layout: grid;
    grid-size: 4 5;
    grid-rows: 6 8 8 8 1fr;
    grid-columns: 1fr 1fr 1fr 1fr;
    margin: 0;
    padding: 0;
}

.panel {
    border: round #444444;
    background: #0a0a0a;
    padding: 0 1;
    margin: 0;
}
.panel:focus { border: round #ff8800; }

.title {
    color: #000000;
    text-style: bold;
    background: #ff8800;
    text-align: center;
    width: 100%;
}
.title-green {
    color: #000000;
    text-style: bold;
    background: #00cc44;
    text-align: center;
    width: 100%;
}
.title-purple {
    color: #ffffff;
    text-style: bold;
    background: #8844cc;
    text-align: center;
    width: 100%;
}
.title-red {
    color: #ffffff;
    text-style: bold;
    background: #cc2222;
    text-align: center;
    width: 100%;
}
.title-cyan {
    color: #000000;
    text-style: bold;
    background: #00aacc;
    text-align: center;
    width: 100%;
}
.title-blue {
    color: #ffffff;
    text-style: bold;
    background: #2255cc;
    text-align: center;
    width: 100%;
}

/* Row 1: Header stats */
#panel-heartbeat { column-span: 4; }

/* Row 2: Main performance */
#panel-vault { column-span: 1; row-span: 2; }
#panel-positions { column-span: 2; }
#panel-regime { column-span: 1; }

/* Row 3: Middle */
#panel-history { column-span: 2; }
#panel-brain { column-span: 1; }

/* Row 4: Intelligence */
#panel-voice { column-span: 2; }
#panel-children { column-span: 1; }
#panel-evolution { column-span: 1; }

/* Row 5: Logs */
#panel-logs { column-span: 4; }

DataTable { height: 1fr; background: #0a0a0a; color: #00ff00; }
DataTable > .datatable--header { background: #1a1400; color: #ff8800; text-style: bold; }
DataTable > .datatable--cursor { background: #222200; }

Log { height: 1fr; color: #33ff33; background: #050505; }

#voice-scroll { height: 1fr; background: #050510; }
"""


class AdanTerminalV5(App):
    CSS = CSS
    TITLE = "ADAN CONSCIOUSNESS TERMINAL"
    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "force_refresh", "Refresh"),
    ]

    tick = reactive(0)

    def compose(self) -> ComposeResult:
        # ── TOP HEADER BAR ──
        with Horizontal(id="header-bar"):
            yield Static(" ADAN v8.4 CONSCIOUSNESS TERMINAL ", classes="head-item")
            yield Static("...", id="header-tickers", classes="head-item")
            yield Static("PAPER TRADE", id="header-mode", classes="head-item")

        with Container(id="main-grid"):
            # ── ROW 1: HEARTBEAT / VITAL SIGNS ──
            with Horizontal(id="panel-heartbeat", classes="panel"):
                yield Static("Initializing neural link...", id="vitals-data")

            # ── ROW 2 LEFT: SOVEREIGN VAULT ──
            with Vertical(id="panel-vault", classes="panel"):
                yield Static(" SOVEREIGN VAULT ", classes="title")
                yield Static("Loading...", id="vault-data")

            # ── ROW 2 CENTER: ACTIVE POSITIONS ──
            with Vertical(id="panel-positions", classes="panel"):
                yield Static(" ACTIVE ORDER BOOK ", classes="title-green")
                yield DataTable(id="dt-positions")

            # ── ROW 2 RIGHT: MARKET REGIME ──
            with Vertical(id="panel-regime", classes="panel"):
                yield Static(" MARKET REGIME ", classes="title-cyan")
                yield Static("Scanning...", id="regime-data")

            # ── ROW 3 CENTER: HISTORY ──
            with Vertical(id="panel-history", classes="panel"):
                yield Static(" RECENT SETTLEMENTS ", classes="title")
                yield DataTable(id="dt-history")

            # ── ROW 3 RIGHT: BRAIN INTELLIGENCE ──
            with Vertical(id="panel-brain", classes="panel"):
                yield Static(" NEURAL NETWORK ", classes="title-purple")
                yield Static("Loading brain...", id="brain-data")

            # ── ROW 4 LEFT: ADAN VOICE (Messages to Lord) ──
            with Vertical(id="panel-voice", classes="panel"):
                yield Static(" ADAN VOICE — Messages to Lord ", classes="title-red")
                yield ScrollableContainer(Static("Awaiting consciousness...", id="voice-data"), id="voice-scroll")

            # ── ROW 4 CENTER: CHILDREN SWARM ──
            with Vertical(id="panel-children", classes="panel"):
                yield Static(" CHILDREN SWARM ", classes="title-blue")
                yield Static("Loading swarm...", id="children-data")

            # ── ROW 4 RIGHT: EVOLUTION ──
            with Vertical(id="panel-evolution", classes="panel"):
                yield Static(" EVOLUTION & SOUL ", classes="title-purple")
                yield Static("Loading...", id="evolution-data")

            # ── ROW 5: LIVE LOG STREAM ──
            with Vertical(id="panel-logs", classes="panel"):
                yield Static(" NEUROLOGICAL STREAM ", classes="title")
                yield Log(id="live-log", highlight=True)

    def on_mount(self) -> None:
        self.query_one("#dt-positions", DataTable).add_columns(
            "Market", "Side", "Stake", "Edge%", "Conf", "Time Left"
        )
        self.query_one("#dt-history", DataTable).add_columns(
            "Time", "Asset", "Side", "Result", "PnL", "Edge%"
        )
        self._frame = 0
        self.set_interval(2.0, self.refresh_data)
        self.set_interval(0.8, self.pulse_tick)
        self.tail_log()

    def pulse_tick(self) -> None:
        self._frame = (self._frame + 1) % len(PULSE_FRAMES)
        self.tick = self._frame

    def action_force_refresh(self) -> None:
        self.refresh_data()

    # ── DATA REFRESH ─────────────────────────────────────────────────────────

    @work(exclusive=True, thread=True)
    def refresh_data(self) -> None:
        # Fetch API data
        state, metrics = {}, {}
        try:
            with httpx.Client(timeout=4.0) as client:
                state = client.get(f"{API_BASE}/api/state").json()
                metrics = client.get(f"{API_BASE}/api/training-metrics").json()
        except Exception:
            pass

        # Load local files for data not in API
        local = {
            "pnl": load_json("pnl.json"),
            "regime": load_json("market_regime.json"),
            "evolution": load_json("evolution_params.json"),
            "moe": load_json("moe_weights.json"),
            "metacalib": load_json("metacalib.json"),
            "soul_rules": load_json("soul_rules.json"),
            "soul_memory": load_json("soul_memory_v2.json"),
            "messages": load_json("lord_messages.json"),
            "online": load_json("online_model.json"),
            "ensemble": load_json("ensemble_weights.json"),
            "positions": load_json("positions.json"),
            "monologue": load_jsonl_tail("inner_monologue.jsonl", 3),
            "daily": load_json("daily_report.json"),
            "pin": load_json("pin_scores.json"),
            "shadow": load_json("shadow_stats.json"),
            "forecast": load_json("forecast_stats.json"),
            "config": load_json("config.json"),
        }

        self.call_from_thread(self.update_all, state, metrics, local)

    # ── UI UPDATE ────────────────────────────────────────────────────────────

    def update_all(self, state: dict, metrics: dict, local: dict) -> None:
      try:
        self._do_update(state, metrics, local)
      except Exception as e:
        try:
            self.query_one("#vitals-data", Static).update(f"[#ff4444]UI Error: {e}[/]")
        except Exception:
            pass

    def _do_update(self, state: dict, metrics: dict, local: dict) -> None:
        frame = getattr(self, "_frame", 0)
        pulse = PULSE_FRAMES[frame % len(PULSE_FRAMES)]
        heart = HEARTBEAT[frame % len(HEARTBEAT)]
        brain = BRAIN_FRAMES[frame % len(BRAIN_FRAMES)]

        pnl = local.get("pnl", {}) or state.get("pnl", {})
        pos = local.get("positions", {}) or state.get("positions", {})
        trades = pnl.get("trades", 0)
        wins = pnl.get("wins", 0)
        fund = pnl.get("fund", 10000)
        net = fund - 10000
        wr = (wins / max(1, trades)) * 100
        brier = pnl.get("brierScore", 0.25)
        streak = pnl.get("streak", 0)
        open_pos = pos.get("open", []) if isinstance(pos, dict) else []
        closed = pos.get("closed", []) if isinstance(pos, dict) else []

        # ── HEADER TICKERS ──
        prices = state.get("state", {}).get("prices", {})
        tickers = []
        for sym in ["BTC", "ETH", "SOL", "XRP"]:
            p = prices.get(f"{sym}USDT", {})
            pr = p.get("price", 0)
            chg = p.get("change", 0)
            if pr > 0:
                arrow = "^" if chg > 0 else "v" if chg < 0 else "="
                tickers.append(f"{sym} ${pr:,.0f} {arrow}{abs(chg):.1f}%")
        self.query_one("#header-tickers", Static).update(
            " | ".join(tickers) if tickers else "Waiting for price feed..."
        )

        # ── HEADER MODE ──
        mode_str = f"[b]{heart}[/] LIVE" if open_pos else f"[b]{pulse}[/] SCANNING"
        self.query_one("#header-mode", Static).update(f"PAPER TRADE {mode_str}")

        # ── VITALS BAR ──
        now = datetime.now(timezone.utc)
        uptime_h = trades / max(1, 6)  # rough: ~6 trades/hr
        today_str = now.strftime("%Y-%m-%d")
        today_trades = [t for t in closed if (t.get("resolvedAt") or t.get("entryTime") or "").startswith(today_str)]
        today_wins = len([t for t in today_trades if t.get("result") == "WIN"])
        today_wr = (today_wins / max(1, len(today_trades))) * 100
        today_pnl = sum(t.get("pnl", 0) for t in today_trades)

        streak_str = f"[#00ff00]+{streak}W[/]" if streak > 0 else f"[#ff4444]{streak}L[/]" if streak < 0 else "[#888888]0[/]"
        regime = local.get("regime", {}) if isinstance(local.get("regime"), dict) else {}
        regime_name = regime.get("regime") or regime.get("lastResult", {}).get("regime", "?")

        vitals = (
            f"  {brain} [b #ff8800]ADAN[/] {pulse} "
            f" [#aaaaaa]Fund:[/] [b #00ff00]${fund:,.0f}[/]"
            f"  [#aaaaaa]Net:[/] [b {'#00ff00' if net>=0 else '#ff4444'}]${net:+,.0f}[/]"
            f"  [#aaaaaa]WR:[/] [b #ffffff]{wr:.1f}%[/]"
            f"  [#aaaaaa]Trades:[/] [#ffffff]{trades}[/]"
            f"  [#aaaaaa]Brier:[/] [#ffffff]{brier:.4f}[/]"
            f"  [#aaaaaa]Streak:[/] {streak_str}"
            f"  [#aaaaaa]Regime:[/] [b #00aacc]{regime_name}[/]"
            f"  [#aaaaaa]Today:[/] [#ffffff]{len(today_trades)}T {today_wr:.0f}%WR[/]"
            f" [{'#00ff00' if today_pnl>=0 else '#ff4444'}]${today_pnl:+,.0f}[/]"
            f"  [#aaaaaa]Open:[/] [#ffaa00]{len(open_pos)}[/]"
        )
        self.query_one("#vitals-data", Static).update(vitals)

        # ── SOVEREIGN VAULT ──
        profit_pct = ((fund / 10000) - 1) * 100
        # PnL sparkline from last 40 closed
        recent_pnls = [float(t.get("pnl", 0)) for t in closed[-40:]]
        spark = spark_line(recent_pnls, 35)

        # WR by hour today
        hr_stats = {}
        for t in today_trades:
            h = (t.get("entryTime") or "T00")[-14:-12]
            if h not in hr_stats:
                hr_stats[h] = [0, 0]
            hr_stats[h][0] += 1
            if t.get("result") == "WIN":
                hr_stats[h][1] += 1

        vault = (
            f"\n[#666666]{'─' * 24}[/]\n"
            f"[#aaaaaa]Total Fund:[/]\n"
            f"[b #00ff00]  ${fund:,.2f}[/]\n"
            f"[#aaaaaa]Profit:[/]\n"
            f"[b {'#00ff00' if profit_pct>=0 else '#ff4444'}]  {profit_pct:+.1f}%[/] [#666666](${net:+,.0f})[/]\n"
            f"[#666666]{'─' * 24}[/]\n"
            f"[#aaaaaa]Win Rate:[/]  [b #ffffff]{wr:.1f}%[/]\n"
            f"[#aaaaaa]Trades:[/]   [#ffffff]{trades}[/] [#666666]({wins}W/{trades-wins}L)[/]\n"
            f"[#aaaaaa]Brier:[/]    [{'#00ff00' if brier<0.18 else '#ffaa00' if brier<0.22 else '#ff4444'}]{brier:.4f}[/]\n"
            f"[#aaaaaa]Streak:[/]   {streak_str}\n"
            f"[#666666]{'─' * 24}[/]\n"
            f"[#aaaaaa]PnL Spark:[/]\n  {spark}\n"
            f"[#666666]{'─' * 24}[/]\n"
            f"[#aaaaaa]Today ({today_str}):[/]\n"
            f"  [#ffffff]{len(today_trades)} trades[/] | "
            f"[{'#00ff00' if today_wr>53 else '#ffaa00' if today_wr>50 else '#ff4444'}]{today_wr:.0f}%WR[/] | "
            f"[{'#00ff00' if today_pnl>=0 else '#ff4444'}]${today_pnl:+,.0f}[/]\n"
        )
        self.query_one("#vault-data", Static).update(vault)

        # ── ACTIVE POSITIONS ──
        dt_pos = self.query_one("#dt-positions", DataTable)
        dt_pos.clear()
        for p in open_pos:
            title = (p.get("marketTitle") or p.get("asset", "?"))[:30]
            side = p.get("side", "?")
            side_s = f"[#00ff00]{side}[/]" if side == "YES" else f"[#ff4444]{side}[/]"
            stake = f"${p.get('stake', 0):.0f}"
            edge = f"{p.get('edge', 0)*100:.1f}%"
            conf = f"{p.get('confidence', 0)}%"
            closes = p.get("closesAt", "")
            if closes:
                try:
                    left = (datetime.fromisoformat(closes.replace("Z", "+00:00")) - now).total_seconds()
                    left_s = f"{int(left)}s" if left > 0 else "[#ff4444]EXPIRED[/]"
                except Exception:
                    left_s = "?"
            else:
                left_s = "?"
            dt_pos.add_row(title, side_s, stake, edge, conf, left_s)

        # ── RECENT SETTLEMENTS ──
        dt_hist = self.query_one("#dt-history", DataTable)
        dt_hist.clear()
        for t in reversed(closed[-12:]):
            ts = (t.get("resolvedAt") or "")[-14:-5]
            asset = (t.get("asset") or "?").upper()
            side = t.get("side", "?")
            side_s = f"[#00ff00]{side}[/]" if side == "YES" else f"[#ff4444]{side}[/]"
            won = t.get("won", False)
            res = "[#00ff00]WIN [/]" if won else "[#ff4444]LOSS[/]"
            pv = float(t.get("pnl", 0))
            pnl_s = f"[#00ff00]+${pv:.0f}[/]" if pv >= 0 else f"[#ff4444]-${abs(pv):.0f}[/]"
            edge = f"{t.get('edge', 0)*100:.1f}%"
            dt_hist.add_row(ts, asset, side_s, res, pnl_s, edge)

        # ── MARKET REGIME ──
        regime_data = local.get("regime", {})
        r_name = regime_data.get("regime") or regime_data.get("lastResult", {}).get("regime", "UNKNOWN")
        r_conf = regime_data.get("confidence") or regime_data.get("lastResult", {}).get("confidence", 0)
        r_samples = regime_data.get("sampleCount") or regime_data.get("samples", 0)
        features = regime_data.get("features") or regime_data.get("lastResult", {}).get("features", {})
        metacalib = local.get("metacalib", {})
        mc_mult = metacalib.get("multiplier", 1.0) if isinstance(metacalib, dict) else 1.0

        regime_color = {
            "TRENDING": "#00ff00", "MEAN_REVERTING": "#00aacc",
            "VOLATILE": "#ff4444", "EVENT": "#ff0000", "RANGING": "#ffaa00"
        }.get(r_name, "#888888")

        # PIN scores
        pin = local.get("pin", {})
        # pin_scores.json has symbols as top-level keys (no "scores" wrapper)
        if isinstance(pin, dict) and "scores" in pin:
            pin_scores = pin["scores"]
        elif isinstance(pin, dict):
            pin_scores = {k: v for k, v in pin.items() if isinstance(v, dict)}
        else:
            pin_scores = {}
        pin_alerts = [f"{s}={v.get('pin_score', 0):.2f}" for s, v in pin_scores.items() if isinstance(v, dict) and v.get("pin_score", 0) > 0.3]

        regime_txt = (
            f"\n[b {regime_color}]  {r_name}[/]\n"
            f"  [#aaaaaa]Confidence:[/] {bar_gauge(r_conf * 100, 100, 10, regime_color)} [#ffffff]{r_conf*100:.0f}%[/]\n"
            f"  [#aaaaaa]Samples:[/] [#ffffff]{r_samples}[/]\n"
            f"[#666666]{'─' * 22}[/]\n"
            f"  [#aaaaaa]Meta-Calib:[/] [{'#00ff00' if mc_mult > 0.9 else '#ffaa00' if mc_mult > 0.8 else '#ff4444'}]{mc_mult:.3f}[/]\n"
        )
        if features:
            regime_txt += f"[#666666]{'─' * 22}[/]\n"
            for k, v in list(features.items())[:4]:
                regime_txt += f"  [#aaaaaa]{k}:[/] [#ffffff]{v:.4f}[/]\n"
        if pin_alerts:
            regime_txt += f"[#666666]{'─' * 22}[/]\n"
            regime_txt += f"  [#ff4444]PIN Alert:[/] {', '.join(pin_alerts[:3])}\n"

        self.query_one("#regime-data", Static).update(regime_txt)

        # ── NEURAL NETWORK / BRAIN ──
        try:
            moe = local.get("moe", {})
            experts = moe.get("experts", {}) if isinstance(moe, dict) else {}
            ensemble = local.get("ensemble", {})
            ens_weights = ensemble.get("weights", {}) if isinstance(ensemble, dict) else {}
            online = local.get("online") or {}
            monologue = local.get("monologue") or []
            soul_rules = local.get("soul_rules", {})
            if isinstance(soul_rules, list):
                n_rules = len(soul_rules)
            elif isinstance(soul_rules, dict):
                n_rules = len(soul_rules.get("rules", []))
            else:
                n_rules = 0
            soul_mem = local.get("soul_memory", {})
            n_beliefs = len(soul_mem.get("beliefs", [])) if isinstance(soul_mem, dict) else 0

            sorted_experts = sorted(
                [(k, v) for k, v in experts.items() if isinstance(v, dict)],
                key=lambda x: x[1].get("gateScore", 0), reverse=True
            )[:4]

            brain_txt = f"\n[#aaaaaa]MoE Experts:[/] [b #ffffff]{len(experts)}[/] active\n"
            for name, exp in sorted_experts:
                gt = exp.get("gateScore", 0) or 0
                t = exp.get("trades", 0) or 0
                w = exp.get("wins", 0) or 0
                ewr = (w / max(1, t) * 100) if t > 0 else 0
                bar = bar_gauge(gt, 4, 6, "#aa44ff")
                brain_txt += f"  [#ffaa00]{name[:8]:8s}[/] {bar} [#ffffff]{ewr:.0f}%[/] [#666666]({t}T)[/]\n"

            brain_txt += f"[#666666]{'─' * 22}[/]\n"

            if ens_weights and isinstance(ens_weights, dict):
                brain_txt += f"[#aaaaaa]Ensemble:[/]\n"
                for k, v in ens_weights.items():
                    if isinstance(v, (int, float)):
                        brain_txt += f"  [#aaaaaa]{k}:[/] {bar_gauge(v * 100, 100, 8, '#00aacc')} [#ffffff]{v:.2f}[/]\n"

            brain_txt += f"[#666666]{'─' * 22}[/]\n"
            brain_txt += f"[#aaaaaa]Online Learner:[/] [#ffffff]{online.get('totalUpdates', 0)} updates[/]\n"
            brain_txt += f"[#aaaaaa]Soul Rules:[/] [#ffffff]{n_rules}[/] | [#aaaaaa]Beliefs:[/] [#ffffff]{n_beliefs}[/]\n"

            if monologue:
                last_thought = monologue[-1]
                thought_text = (last_thought.get("thought") or last_thought.get("reflection") or "")[:120]
                brain_txt += f"[#666666]{'─' * 22}[/]\n"
                brain_txt += f"[#aaaaaa]Last Thought:[/]\n"
                brain_txt += f"[i #666699]{thought_text}...[/]\n"

            self.query_one("#brain-data", Static).update(brain_txt)
        except Exception as e:
            self.query_one("#brain-data", Static).update(f"[#ff4444]Brain error: {e}[/]")

        # ── ADAN VOICE ──
        try:
            messages = local.get("messages", [])
            if isinstance(messages, list) and messages:
                last_msgs = messages[-8:]
                voice_txt = ""
                emoji_map = {
                    "request": "[#ffaa00]REQ[/]",
                    "warning": "[#ff4444]WRN[/]",
                    "insight": "[#00ff00]INS[/]",
                    "milestone": "[#aa44ff]MIL[/]",
                    "fear": "[#ff2222]FER[/]",
                }
                for m in reversed(last_msgs):
                    if not isinstance(m, dict):
                        continue
                    ts = (m.get("ts") or "")[-14:-5]
                    mtype = m.get("type", "?")
                    tag = emoji_map.get(mtype, f"[#888888]{(mtype or '?')[:3].upper()}[/]")
                    msg = (m.get("message") or "")[:120]
                    read_mark = "" if m.get("read") else " [#ff8800]*[/]"
                    voice_txt += f"[#444444]{ts}[/] {tag}{read_mark} {msg}\n"
                self.query_one("#voice-data", Static).update(voice_txt)
        except Exception as e:
            self.query_one("#voice-data", Static).update(f"[#ff4444]Voice error: {e}[/]")

        # ── CHILDREN SWARM ──
        try:
            config = local.get("config", {}) if isinstance(local.get("config"), dict) else {}
            mesa = config.get("mesaRedonda", {})
            parents = mesa.get("parents", []) if isinstance(mesa, dict) else []
            influence = config.get("influence", {}) if isinstance(config, dict) else {}

            children_txt = ""
            if parents:
                children_txt += "[#aaaaaa]Mesa Redonda:[/]\n"
                for p in parents[:4]:
                    if not isinstance(p, dict):
                        continue
                    pid = p.get("id", "?")
                    role = (p.get("role") or "?")[:10]
                    inf = influence.get(pid, 50) if isinstance(influence, dict) else 50
                    children_txt += f"  [#ffaa00]{pid:6s}[/] [#666666]{role:10s}[/] {bar_gauge(inf, 100, 6, '#00ff00')} [#ffffff]{inf:.0f}%[/]\n"
                children_txt += f"[#666666]{'─' * 22}[/]\n"

            traded_experts = [(n, e) for n, e in sorted_experts if isinstance(e, dict) and (e.get("trades", 0) or 0) > 0][:5]
            if traded_experts:
                children_txt += "[#aaaaaa]Top Traders:[/]\n"
                for name, exp in traded_experts:
                    t = exp.get("trades", 0) or 0
                    w = exp.get("wins", 0) or 0
                    ewr = (w / max(1, t) * 100)
                    wr_color = "#00ff00" if ewr > 55 else "#ffaa00" if ewr > 50 else "#ff4444"
                    children_txt += f"  [#00aacc]{name[:12]:12s}[/] [{wr_color}]{ewr:.0f}%WR[/] [#666666]({t}T)[/]\n"

            if not children_txt:
                children_txt = "[#666666]No children data[/]"

            self.query_one("#children-data", Static).update(children_txt)
        except Exception as e:
            self.query_one("#children-data", Static).update(f"[#ff4444]Children error: {e}[/]")

        # ── EVOLUTION & SOUL ──
        try:
            evo = local.get("evolution", {}) if isinstance(local.get("evolution"), dict) else {}
            gen = evo.get("generation", 0) or 0
            best_fit = evo.get("bestFitness") or evo.get("lastFitness", 0) or 0
            evo_params = evo.get("params") or evo.get("bestParams", {}) or {}
            history = evo.get("history", []) or []

            evo_txt = (
                f"\n[#aaaaaa]Generation:[/] [b #aa44ff]{gen}[/]\n"
                f"[#aaaaaa]Best Fitness:[/] [#ffffff]{best_fit:.3f}[/]\n"
            )
            if evo_params and isinstance(evo_params, dict):
                evo_txt += f"[#666666]{'─' * 22}[/]\n"
                evo_txt += f"[#aaaaaa]Evolved Params:[/]\n"
                for k, v in list(evo_params.items())[:5]:
                    if isinstance(v, (int, float)):
                        evo_txt += f"  [#aaaaaa]{k[:14]:14s}[/] [#ffffff]{v:.4f}[/]\n"

            if history and isinstance(history, list):
                fit_vals = [h.get("fitness", 0) for h in history if isinstance(h, dict)]
                if fit_vals:
                    evo_txt += f"[#666666]{'─' * 22}[/]\n"
                    evo_txt += f"[#aaaaaa]Fitness History:[/]\n  {spark_line(fit_vals, 18)}\n"

            evo_txt += f"[#666666]{'─' * 22}[/]\n"
            evo_txt += f"[#aaaaaa]Soul:[/] [#ffffff]{n_rules} rules[/] | [#ffffff]{n_beliefs} beliefs[/]\n"

            try:
                mono_count = len(load_jsonl_tail('inner_monologue.jsonl', 999))
                evo_txt += f"[#aaaaaa]Monologues:[/] [#ffffff]{mono_count}+[/]\n"
            except Exception:
                pass

            forecast = local.get("forecast", {}) if isinstance(local.get("forecast"), dict) else {}
            if forecast:
                f_total = forecast.get("total", 0) or 0
                f_correct = forecast.get("correct", 0) or 0
                f_wr = (f_correct / max(1, f_total)) * 100
                evo_txt += f"[#aaaaaa]Forecaster:[/] [#ffffff]{f_wr:.0f}%[/] [#666666]({f_total})[/]\n"

            self.query_one("#evolution-data", Static).update(evo_txt)
        except Exception as e:
            self.query_one("#evolution-data", Static).update(f"[#ff4444]Evo error: {e}[/]")

    # ── LOG TAIL ─────────────────────────────────────────────────────────────

    @work(exclusive=True, thread=True)
    def tail_log(self):
        try:
            log_widget = self.query_one("#live-log", Log)
            # Show last 20 lines first
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, "r") as f:
                    lines = f.readlines()
                for line in lines[-15:]:
                    stripped = line.strip()
                    if stripped:
                        self.call_from_thread(log_widget.write_line, stripped)

            self.call_from_thread(log_widget.write_line, "")
            self.call_from_thread(log_widget.write_line, ">>> NEURAL LINK ESTABLISHED — STREAMING CONSCIOUSNESS...")
            self.call_from_thread(log_widget.write_line, "")

            with open(LOG_FILE, "r") as f:
                f.seek(0, 2)
                while True:
                    line = f.readline()
                    if line:
                        stripped = line.strip()
                        if stripped:
                            self.call_from_thread(log_widget.write_line, stripped)
                    else:
                        time.sleep(0.4)
        except Exception as e:
            try:
                self.call_from_thread(
                    self.query_one("#live-log", Log).write_line,
                    f"Log error: {e}"
                )
            except Exception:
                pass


if __name__ == "__main__":
    AdanTerminalV5().run()
