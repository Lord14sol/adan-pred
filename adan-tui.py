#!/usr/bin/env python3
"""
ADAN Bloomberg Terminal V3
High-Density Institutional Dashboard
"""
import asyncio
import json
import os
import time
from datetime import datetime
import httpx

from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, Grid
from textual.widgets import Header, Footer, Static, DataTable, Log
from textual.reactive import reactive
from textual import work

API_BASE = "http://localhost:3141"
LOG_FILE = os.path.expanduser("~/.adan-pred/adan.log")
CONFIG_FILE = os.path.expanduser("~/.adan-pred/config.json")

CSS = """
Screen { background: #000000; color: #00ff00; }
#header-bar { height: 1; background: #ffaa00; color: #000000; text-style: bold; layout: horizontal; }
.head-item { width: 1fr; content-align: center middle; }

#main-grid {
    layout: grid;
    grid-size: 4 4;  /* 4 columns, 4 rows */
    grid-rows: 25% 25% 25% 25%;
    grid-columns: 25% 25% 25% 25%;
    margin: 0;
    padding: 0;
}

/* PANELS */
.panel {
    border: ascii #ffaa00;
    background: #000000;
    padding: 0;
    margin: 0;
}

/* Placements */
#panel-stats { column-span: 1; row-span: 3; }
#panel-positions { column-span: 2; row-span: 1; }
#panel-history { column-span: 2; row-span: 2; }
#panel-matrix { column-span: 1; row-span: 2; }
#panel-swarm { column-span: 1; row-span: 1; }
#panel-logs { column-span: 4; row-span: 1; }

.title { color: #000000; text-style: bold; background: #ffaa00; text-align: center; }

DataTable { height: 1fr; background: #000000; color: #00ff00; }
DataTable > .datatable--header { background: #111100; color: #ffaa00; }
DataTable > .datatable--cursor { background: #333300; }

Log { height: 1fr; color: #00ff00; background: #000000; }
"""

class AdanBloombergV3(App):
    CSS = CSS
    BINDINGS = [("q", "quit", "Quit")]

    def compose(self) -> ComposeResult:
        with Horizontal(id="header-bar"):
            yield Static(" ADAN 4.9 PRO - BLOOMBERG TERMINAL V3 ", classes="head-item")
            yield Static("Connecting to feed...", id="header-tickers", classes="head-item")
            yield Static("LIVE · PAPER TRADE", classes="head-item")

        with Container(id="main-grid"):
            # LEFT: STATS & SPARKLINE
            with Vertical(id="panel-stats", classes="panel"):
                yield Static(" SOVEREIGN VAULT ", classes="title")
                yield Static("Loading...", id="vault-data")
                yield Static("\n PNL SPARKLINE ", classes="title")
                yield Static("", id="sparkline-data")

            # CENTER TOP: ACTIVE POSITIONS
            with Vertical(id="panel-positions", classes="panel"):
                yield Static(" ACTIVE ORDER BOOK ", classes="title")
                yield DataTable(id="dt-positions")

            # RIGHT TOP1: MARKET MATRIX
            with Vertical(id="panel-matrix", classes="panel"):
                yield Static(" ORACLE MATRIX ", classes="title")
                yield DataTable(id="dt-matrix")

            # CENTER MID: HISTORICAL SETTLEMENTS (Takes 2 rows)
            with Vertical(id="panel-history", classes="panel"):
                yield Static(" RECENT SETTLEMENTS (HISTORICAL) ", classes="title")
                yield DataTable(id="dt-history")

            # RIGHT TOP2: AI SWARM DNA
            with Vertical(id="panel-swarm", classes="panel"):
                yield Static(" AI SWARM DNA (LIVE) ", classes="title")
                yield Static("Fetching DNA...", id="swarm-data")

            # BOTTOM: LIVE LOGS
            with Vertical(id="panel-logs", classes="panel"):
                yield Static(" NEUROLOGICAL STREAM (adan.log tail) ", classes="title")
                yield Log(id="live-log", highlight=True)

    def on_mount(self) -> None:
        # Columns Setup
        self.query_one("#dt-positions", DataTable).add_columns("Market", "Side", "Stake", "Edge", "PnL")
        self.query_one("#dt-history", DataTable).add_columns("Time", "Market", "Result", "Stake", "PnL")
        self.query_one("#dt-matrix", DataTable).add_columns("Sym", "Price", "2m \u0394", "Signal")

        self.set_interval(2.0, self.refresh_data)
        self.tail_log()

    @work(exclusive=True, thread=True)
    def refresh_data(self) -> None:
        try:
            with httpx.Client(timeout=3.0) as client:
                state = client.get(f"{API_BASE}/api/state").json()
                metrics = client.get(f"{API_BASE}/api/training-metrics").json()
            self.call_from_thread(self.update_ui, state, metrics)
        except Exception:
            pass

    def update_ui(self, state: dict, metrics: dict) -> None:
        # --- 1. SOVEREIGN VAULT ---
        pnl = state.get("pnl", {})
        fund = pnl.get("fund", 0)
        net = pnl.get("net", 0)
        wr = pnl.get("wins", 0) / max(1, pnl.get("trades", 1)) * 100
        
        vault_text = f"""
[#aaaaaa]Total Fund:[/]
[b #00ff00]${fund:,.2f}[/]

[#aaaaaa]Net PnL:[/]
[b {'#00ff00' if net>=0 else '#ff4444'}]{net:+.2f}[/]

[#aaaaaa]Win Rate:[/]    [#ffffff]{wr:.1f}%[/]
[#aaaaaa]Trades:[/]      [#ffffff]{pnl.get('trades', 0)}[/]
[#aaaaaa]Level:[/]       [#ffaa00]{state.get('xp', {}).get('level', 0)}[/]
[#aaaaaa]Brier Score:[/] [#ffffff]{pnl.get('brierScore', 0):.4f}[/]
"""
        self.query_one("#vault-data", Static).update(vault_text)

        # --- 2. SPARKLINE ---
        closed = state.get("positions", {}).get("closed", [])
        spark_char = [" ", "▂", "▃", "▄", "▅", "▆", "▇", "█"]
        if closed:
            recent_closed = closed[-25:]
            pnls = [float(t.get("pnl", 0)) for t in recent_closed]
            min_p = min(pnls)
            max_p = max(pnls)
            rng = max_p - min_p if max_p != min_p else 1
            spark = ""
            for p in pnls:
                idx = int(((p - min_p) / rng) * 7)
                color = "green" if p >= 0 else "red"
                spark += f"[{color}]{spark_char[idx]}[/]"
            self.query_one("#sparkline-data", Static).update(f"\n{spark}\n\n[#aaaaaa]Last 25 Trades[/]")

        # --- 3. ACTIVE POSITIONS ---
        dt_pos = self.query_one("#dt-positions", DataTable)
        dt_pos.clear()
        opens = state.get("positions", {}).get("open", [])
        for pos in opens:
            title = pos.get("marketTitle", "")[:35]
            side = pos.get("side", "YES")
            side_str = f"[#00ff00]{side}[/]" if side == "YES" else f"[#ff4444]{side}[/]"
            stake = f"${pos.get('stake', 0):.0f}"
            edge = f"{pos.get('edge', 0)*100:.1f}%"
            epnl = pos.get('stake',0) * pos.get('edge',0)
            pnl_s = f"[#00ff00]+${epnl:.1f}[/]" if epnl >= 0 else f"[#ff4444]-${abs(epnl):.1f}[/]"
            dt_pos.add_row(title, side_str, stake, edge, pnl_s)

        # --- 4. HISTORICAL SETTLEMENTS ---
        dt_hist = self.query_one("#dt-history", DataTable)
        dt_hist.clear()
        if closed:
            # Show last 15 trades inverted (newest first)
            for pos in reversed(closed[-15:]):
                time_str = pos.get("resolvedAt", "")[-14:-5] # Get Time HH:MM:SS
                title = pos.get("marketTitle", "")[:45]
                won = pos.get("won", False)
                res_str = "[#00ff00]WIN[/]" if won else "[#ff4444]LOSS[/]"
                stake = f"${pos.get('stake', 0):.0f}"
                pnl_val = float(pos.get("pnl", 0))
                pnl_s = f"[#00ff00]+${pnl_val:.1f}[/]" if pnl_val >= 0 else f"[#ff4444]-${abs(pnl_val):.1f}[/]"
                dt_hist.add_row(time_str, title, res_str, stake, pnl_s)

        # --- 5. ORACLE MATRIX ---
        dt_mat = self.query_one("#dt-matrix", DataTable)
        dt_mat.clear()
        prices = state.get("state", {}).get("prices", {})
        t_strings = []
        for sym in ["BTC", "ETH", "SOL", "BNB"]:
            p = prices.get(f"{sym}USDT", {})
            pr = p.get('price', 0)
            chg = p.get('change', 0)
            if pr > 0:
                t_strings.append(f"{sym}: ${pr:,.0f}")
                col = "[#00ff00]" if chg > 0 else "[#ff4444]"
                sig = "SCANNING" if abs(chg) < 0.3 else "[b #ffaa00]VOLATILE[/]"
                dt_mat.add_row(sym, f"${pr:,.2f}", f"{col}{chg:+.2f}%[/]", sig)
        
        if t_strings:
            self.query_one("#header-tickers", Static).update(" | ".join(t_strings))

        # --- 6. AI SWARM DNA ---
        cert = metrics.get("certification", {})
        human = metrics.get("human", {}).get("stateBreakdown", {})
        top_state = max(human, key=human.get) if human else "RATIONAL"
        
        # Read from config to get LIVE agent weights
        virus, apple, snake, eva = 50, 50, 50, 0
        try:
            with open(CONFIG_FILE, 'r') as f:
                cfg = json.load(f)
                inf = cfg.get("influence", {})
                virus = inf.get("virus", 50)
                apple = inf.get("apple", 50)
                snake = inf.get("snake", 50)
                eva = inf.get("eva", 0)
        except Exception:
            pass

        swarm_txt = f"""
[#aaaaaa]Primary Human State:[/]
[b #ffaa00]{top_state}[/]

[#aaaaaa]Certification Score:[/] [#00ff00]{cert.get('score', 0)}%[/]

[#aaaaaa]VIRUS (Trend):[/]  [#00ff00]{virus:.1f}%[/]
[#aaaaaa]APPLE (Logic):[/]  [#00ff00]{apple:.1f}%[/]
[#aaaaaa]SNAKE (Fear):[/]   [#00ff00]{snake:.1f}%[/]
[#aaaaaa]EVA   (Truth):[/] [#ff4444 if eva==0 else '#aa44ff']{eva:.1f}%[/]
"""
        self.query_one("#swarm-data", Static).update(swarm_txt)


    @work(exclusive=True, thread=True)
    def tail_log(self):
        try:
            with open(LOG_FILE, "r") as f:
                f.seek(0, 2)
                log_widget = self.query_one("#live-log", Log)
                log_widget.write_line(">>> ESTABLISHING NEUROLINK SECURE CONNECTION...")
                log_widget.write_line(">>> AWAITING SIGNAL FROM ADAN CORE...")
                while True:
                    line = f.readline()
                    if line:
                        self.call_from_thread(log_widget.write_line, line.strip())
                    else:
                        time.sleep(0.5)
        except Exception as e:
            self.call_from_thread(self.query_one("#live-log", Log).write_line, f"Error reading log: {e}")

if __name__ == "__main__":
    AdanBloombergV3().run()
