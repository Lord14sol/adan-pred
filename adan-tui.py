#!/usr/bin/env python3
"""
╔══════════════════════════════════════════════════════════════════════╗
║  ADAN · Terminal Command Center                                      ║
║  Cyberpunk TUI Dashboard — Real-time position & trade monitoring     ║
║  Connects to ADAN API at localhost:3141                              ║
║  Run: python3 adan-tui.py                                            ║
╚══════════════════════════════════════════════════════════════════════╝
"""

import asyncio
import json
import random
from datetime import datetime, timezone
from typing import Optional

import httpx
from textual.app import App, ComposeResult
from textual.containers import Container, Horizontal, Vertical, ScrollableContainer
from textual.widgets import Header, Footer, Static, DataTable, ProgressBar, Label, Rule
from textual.reactive import reactive
from textual.timer import Timer
from textual import work
from textual.css.query import NoMatches

API_BASE = "http://localhost:3141"

# ── Styles ─────────────────────────────────────────────────────────────────
CSS = """
Screen {
    background: #0a0a0f;
}

#topbar {
    height: 3;
    background: #0d0d18;
    border-bottom: solid #1a4a8a;
    layout: horizontal;
}
#topbar-logo {
    width: 30;
    content-align: left middle;
    padding: 0 1;
    color: #00ff88;
    text-style: bold;
}
#topbar-status {
    width: 1fr;
    content-align: center middle;
    color: #888;
}
#topbar-stats {
    width: 50;
    content-align: right middle;
    padding: 0 1;
    color: #aaa;
}

#main {
    layout: vertical;
}

/* ── Position Grid ─── */
#position-grid {
    height: 14;
    layout: horizontal;
    margin: 0 1;
}

.pos-panel {
    width: 1fr;
    height: 100%;
    background: #0d0d18;
    border: solid #1a2a4a;
    padding: 0 1;
    margin: 0 1 0 0;
}
.pos-panel:last-of-type {
    margin: 0;
}

.pos-title {
    color: #00ff88;
    text-style: bold;
    text-align: center;
    padding: 0 0 0 0;
}
.pos-market {
    color: #8888aa;
    text-align: center;
    padding: 0;
}
.pos-up-bar {
    color: #00ff88;
    padding: 0;
}
.pos-down-bar {
    color: #ff4444;
    padding: 0;
}
.pos-detail {
    color: #aaaacc;
    padding: 0;
}
.pos-pnl-pos {
    color: #00ff88;
    text-style: bold;
    text-align: center;
}
.pos-pnl-neg {
    color: #ff4444;
    text-style: bold;
    text-align: center;
}
.pos-timer {
    color: #4488ff;
    text-align: center;
}

/* ── Stats Row ─── */
#stats-row {
    height: 5;
    layout: horizontal;
    margin: 1 1 0 1;
}

.stat-box {
    width: 1fr;
    height: 100%;
    background: #0d0d18;
    border: solid #1a2a4a;
    padding: 0 1;
    margin: 0 1 0 0;
    content-align: center middle;
}
.stat-box:last-of-type {
    margin: 0;
}
.stat-label {
    color: #666688;
    text-align: center;
}
.stat-value {
    text-style: bold;
    text-align: center;
}

/* ── Bottom Panels ─── */
#bottom-row {
    height: 1fr;
    layout: horizontal;
    margin: 1 1;
}

#trade-log-panel {
    width: 2fr;
    background: #0d0d18;
    border: solid #1a2a4a;
    padding: 0 1;
    margin: 0 1 0 0;
}
#trade-log-title {
    color: #ff8800;
    text-style: bold;
    padding: 0 0 0 0;
}

#mother-code-panel {
    width: 1fr;
    background: #0d0d18;
    border: solid #1a2a4a;
    padding: 0 1;
}
#mc-title {
    color: #aa44ff;
    text-style: bold;
    padding: 0;
}
.mc-row {
    color: #aaaacc;
}
.mc-val-green {
    color: #00ff88;
    text-style: bold;
}
.mc-val-red {
    color: #ff4444;
    text-style: bold;
}
.mc-val-yellow {
    color: #ffaa00;
    text-style: bold;
}
.mc-val-cyan {
    color: #44aaff;
    text-style: bold;
}
.mc-val-purple {
    color: #aa44ff;
    text-style: bold;
}

DataTable {
    background: #0a0a0f;
    color: #ccccdd;
    height: 1fr;
}
DataTable > .datatable--header {
    background: #1a1a2e;
    color: #44aaff;
    text-style: bold;
}
DataTable > .datatable--cursor {
    background: #1a2a4a;
}

#price-ticker {
    height: 3;
    background: #080812;
    border-top: solid #1a2a4a;
    layout: horizontal;
    padding: 0 1;
}
.ticker-item {
    width: 1fr;
    content-align: center middle;
    color: #aaa;
}
"""


class PositionPanel(Static):
    """A single position card showing market data."""

    def __init__(self, idx: int, **kwargs):
        super().__init__(**kwargs)
        self.idx = idx
        self._data = None

    def compose(self) -> ComposeResult:
        yield Static("▶ POSITION " + str(self.idx + 1), classes="pos-title", id=f"pt-{self.idx}")
        yield Static("Loading...", classes="pos-market", id=f"pm-{self.idx}")
        yield Static("", classes="pos-up-bar", id=f"pub-{self.idx}")
        yield Static("", classes="pos-down-bar", id=f"pdb-{self.idx}")
        yield Static("", classes="pos-detail", id=f"pd-{self.idx}")
        yield Static("", classes="pos-pnl-pos", id=f"ppnl-{self.idx}")
        yield Static("", classes="pos-timer", id=f"ptm-{self.idx}")

    def update_data(self, pos: Optional[dict], prices: dict):
        """Update panel with position data or empty state."""
        try:
            title_el = self.query_one(f"#pt-{self.idx}", Static)
            market_el = self.query_one(f"#pm-{self.idx}", Static)
            up_el = self.query_one(f"#pub-{self.idx}", Static)
            down_el = self.query_one(f"#pdb-{self.idx}", Static)
            detail_el = self.query_one(f"#pd-{self.idx}", Static)
            pnl_el = self.query_one(f"#ppnl-{self.idx}", Static)
            timer_el = self.query_one(f"#ptm-{self.idx}", Static)

            if pos is None:
                title_el.update("▷ POSITION " + str(self.idx + 1) + " · EMPTY")
                market_el.update("Waiting for entry signal...")
                up_el.update("")
                down_el.update("")
                detail_el.update("")
                pnl_el.update("—")
                timer_el.update("")
                return

            title = (pos.get("marketTitle", "") or "")[:45]
            side = pos.get("side", "YES")
            stake = float(pos.get("stake", 0))
            edge = float(pos.get("edge", 0)) * 100
            my_price = float(pos.get("myPrice", 0)) * 100
            mkt_price = float(pos.get("mktPrice", 0)) * 100

            # Determine asset from title
            asset = "BTC" if "Bitcoin" in title or "BTC" in title else \
                    "ETH" if "Ethereum" in title or "ETH" in title else \
                    "SOL" if "Solana" in title or "SOL" in title else "MKT"

            price_key = f"{asset}USDT" if asset != "MKT" else ""
            spot = prices.get(price_key, {}).get("price", 0) if price_key else 0
            chg = prices.get(price_key, {}).get("change", 0) if price_key else 0

            title_el.update(f"▶ POSITION {self.idx + 1} · {asset} · ${stake:.0f}")
            market_el.update(title[:42])

            # UP bar
            up_pct = my_price if side == "YES" else (100 - my_price)
            up_bar_len = max(1, int(up_pct / 100 * 30))
            up_bar = "█" * up_bar_len + "░" * (30 - up_bar_len)
            edge_color = "+" if edge > 0 else ""
            up_el.update(f" UP  [{up_bar}] {up_pct:.1f}% | {edge_color}{edge:.1f}%")

            # DOWN bar
            down_pct = 100 - up_pct
            down_bar_len = max(1, int(down_pct / 100 * 30))
            down_bar = "█" * down_bar_len + "░" * (30 - down_bar_len)
            down_el.update(f" DWN [{down_bar}] {down_pct:.1f}%")

            # Detail
            if spot > 0:
                detail_el.update(f" {asset}: ${spot:,.2f} | Stake: ${stake:.0f} | Side: {side} | Edge: {edge:+.1f}%")
            else:
                detail_el.update(f" Stake: ${stake:.0f} | Side: {side} | Edge: {edge:+.1f}%")

            # PnL estimation
            est_pnl = stake * edge / 100
            if est_pnl >= 0:
                pnl_el.update(f"Est PnL: +${est_pnl:.2f}")
                pnl_el.set_classes("pos-pnl-pos")
            else:
                pnl_el.update(f"Est PnL: -${abs(est_pnl):.2f}")
                pnl_el.set_classes("pos-pnl-neg")

            # Timer
            closes = pos.get("closes", "")
            timer_el.update(f"⏱ Closes: {closes}" if closes else "⏱ Monitoring...")

        except NoMatches:
            pass


class AdanTUI(App):
    """ADAN Terminal Command Center — Cyberpunk TUI."""

    TITLE = "ADAN · Terminal Command Center"
    CSS = CSS
    BINDINGS = [
        ("q", "quit", "Quit"),
        ("r", "force_refresh", "Refresh"),
        ("p", "toggle_pause", "Pause"),
        ("m", "toggle_mc", "Mother Code"),
        ("1", "zoom_1", "Zoom 1"),
        ("2", "zoom_2", "Zoom 2"),
        ("3", "zoom_3", "Zoom 3"),
    ]

    paused = reactive(False)
    last_data = reactive(None)
    mc_data = reactive(None)
    tick_count = reactive(0)

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)

        with Container(id="topbar"):
            yield Static(" ◈ ADAN PRED", id="topbar-logo")
            yield Static("● CONNECTED · PAPER TRADE", id="topbar-status")
            yield Static("refreshing...", id="topbar-stats")

        with Container(id="main"):
            # Position Grid (3 panels)
            with Horizontal(id="position-grid"):
                yield PositionPanel(0, classes="pos-panel", id="panel-0")
                yield PositionPanel(1, classes="pos-panel", id="panel-1")
                yield PositionPanel(2, classes="pos-panel", id="panel-2")

            # Stats Row
            with Horizontal(id="stats-row"):
                with Vertical(classes="stat-box"):
                    yield Static("VAULT", classes="stat-label")
                    yield Static("$--", classes="stat-value", id="sv-fund")
                with Vertical(classes="stat-box"):
                    yield Static("NET P&L", classes="stat-label")
                    yield Static("--", classes="stat-value", id="sv-net")
                with Vertical(classes="stat-box"):
                    yield Static("WIN RATE", classes="stat-label")
                    yield Static("--%", classes="stat-value", id="sv-wr")
                with Vertical(classes="stat-box"):
                    yield Static("TRADES", classes="stat-label")
                    yield Static("--", classes="stat-value", id="sv-trades")
                with Vertical(classes="stat-box"):
                    yield Static("LEVEL", classes="stat-label")
                    yield Static("--", classes="stat-value", id="sv-level")
                with Vertical(classes="stat-box"):
                    yield Static("BRIER", classes="stat-label")
                    yield Static("--", classes="stat-value", id="sv-brier")

            # Bottom: Trade Log + Mother Code
            with Horizontal(id="bottom-row"):
                with Vertical(id="trade-log-panel"):
                    yield Static("▶ TRADE LOG · Live", id="trade-log-title")
                    dt = DataTable(id="trade-table")
                    dt.cursor_type = "row"
                    yield dt

                with Vertical(id="mother-code-panel"):
                    yield Static("▶ MOTHER CODE v2.0", id="mc-title")
                    yield Static("", id="mc-body")

            # Price ticker
            with Horizontal(id="price-ticker"):
                yield Static("BTC: --", classes="ticker-item", id="tk-btc")
                yield Static("ETH: --", classes="ticker-item", id="tk-eth")
                yield Static("SOL: --", classes="ticker-item", id="tk-sol")
                yield Static("BNB: --", classes="ticker-item", id="tk-bnb")
                yield Static("XRP: --", classes="ticker-item", id="tk-xrp")

        yield Footer()

    def on_mount(self) -> None:
        """Set up the trade table and start the refresh timer."""
        table = self.query_one("#trade-table", DataTable)
        table.add_columns("Time", "Action", "Market", "Amount", "Price", "PnL")

        # Start refresh loop
        self.set_interval(1.5, self.refresh_data)

    @work(exclusive=True, thread=True)
    def refresh_data(self) -> None:
        """Fetch data from ADAN API."""
        if self.paused:
            return

        try:
            with httpx.Client(timeout=3.0) as client:
                state_r = client.get(f"{API_BASE}/api/state")
                state = state_r.json()

                mc_r = client.get(f"{API_BASE}/api/training-metrics")
                mc = mc_r.json()

            self.call_from_thread(self._apply_data, state, mc)
        except Exception as e:
            self.call_from_thread(self._show_error, str(e))

    def _show_error(self, msg: str) -> None:
        try:
            self.query_one("#topbar-status", Static).update(f"⚠ ERROR: {msg[:40]}")
        except NoMatches:
            pass

    def _apply_data(self, state: dict, mc: dict) -> None:
        """Apply fetched data to UI."""
        self.tick_count += 1

        pnl = state.get("pnl", {})
        xp = state.get("xp", {})
        st = state.get("state", {})
        positions = state.get("positions", {})
        opens = positions.get("open", [])
        closed = positions.get("closed", [])
        prices = st.get("prices", {})

        # ── Topbar ──
        now = datetime.now().strftime("%H:%M:%S")
        mode = st.get("mode", "idle")
        mode_icon = "⚡" if mode == "thinking" else "●"
        status_text = f"{mode_icon} {'ANALYZING' if mode == 'thinking' else 'MONITORING'} · PAPER TRADE · {now}"
        try:
            self.query_one("#topbar-status", Static).update(status_text)
            stats_text = f"Fund: ${pnl.get('fund', 0):,.0f} | WR: {pnl.get('wins', 0)}/{pnl.get('losses', 0)} | LVL {xp.get('level', 0)}"
            self.query_one("#topbar-stats", Static).update(stats_text)
        except NoMatches:
            pass

        # ── Position Panels ──
        for i in range(3):
            try:
                panel = self.query_one(f"#panel-{i}", PositionPanel)
                pos = opens[i] if i < len(opens) else None
                panel.update_data(pos, prices)
            except NoMatches:
                pass

        # ── Stats Row ──
        fund = pnl.get("fund", 0)
        net = pnl.get("net", 0)
        wins = pnl.get("wins", 0)
        losses = pnl.get("losses", 0)
        trades = wins + losses
        wr = round(wins / max(trades, 1) * 100, 1)
        level = xp.get("level", 0)
        brier = pnl.get("brierScore", None)

        try:
            self.query_one("#sv-fund", Static).update(f"${fund:,.0f}")
            self.query_one("#sv-fund", Static).styles.color = "#00ff88" if fund > 0 else "#ff4444"

            net_str = f"+${net:,.0f}" if net >= 0 else f"-${abs(net):,.0f}"
            self.query_one("#sv-net", Static).update(net_str)
            self.query_one("#sv-net", Static).styles.color = "#00ff88" if net >= 0 else "#ff4444"

            self.query_one("#sv-wr", Static).update(f"{wr}%")
            self.query_one("#sv-wr", Static).styles.color = "#00ff88" if wr >= 55 else "#ffaa00" if wr >= 50 else "#ff4444"

            self.query_one("#sv-trades", Static).update(f"{wins}W/{losses}L ({trades})")

            self.query_one("#sv-level", Static).update(f"LVL {level}")
            self.query_one("#sv-level", Static).styles.color = "#aa44ff"

            brier_str = f"{brier:.3f}" if brier and brier > 0 else "N/A"
            self.query_one("#sv-brier", Static).update(brier_str)
        except NoMatches:
            pass

        # ── Trade Log ──
        try:
            table = self.query_one("#trade-table", DataTable)
            # Only update if we have new data
            if closed and self.tick_count % 3 == 0:
                table.clear()
                for trade in reversed(closed[-15:]):
                    won = trade.get("won", False)
                    t_pnl = float(trade.get("pnl", 0))
                    side = trade.get("side", "YES")
                    stake = float(trade.get("stake", 0))
                    title = (trade.get("marketTitle", "") or "")[:28]
                    ts = trade.get("resolvedAt", trade.get("enteredAt", ""))
                    t_time = ts[-8:] if len(ts) > 8 else ts

                    action = f"[green]WIN {side}[/]" if won else f"[red]LOSS {side}[/]"
                    pnl_str = f"[green]+${t_pnl:.0f}[/]" if t_pnl > 0 else f"[red]-${abs(t_pnl):.0f}[/]"

                    table.add_row(
                        t_time,
                        "WIN" if won else "LOSS",
                        title,
                        f"${stake:.0f}",
                        f"{side}",
                        f"{'+'if t_pnl>0 else ''}{t_pnl:.0f}",
                    )
        except NoMatches:
            pass

        # ── Mother Code Panel ──
        try:
            mc_body = self.query_one("#mc-body", Static)
            cert = mc.get("certification", {})
            mc_pnl = mc.get("pnl", {})
            human = mc.get("human", {}).get("stateBreakdown", {})
            poly = mc.get("polymerase", {})
            lmsr = mc.get("lmsr", {})
            brier_mc = mc.get("brier", {})

            # Human state
            top_state = max(human, key=human.get) if human else "UNKNOWN"
            state_color = "#00ff88" if "RATIONAL" in top_state else \
                          "#ff4444" if "PANIC" in top_state else \
                          "#ffaa00" if "FOMO" in top_state else "#44aaff"

            cert_score = cert.get("score", 0)
            cert_bar_len = max(0, int(cert_score / 100 * 20))
            cert_bar = "█" * cert_bar_len + "░" * (20 - cert_bar_len)
            cert_status = (cert.get("status", "") or "").replace("_", " ")

            poly_blocks = poly.get("totalBlocks", 0)
            lmsr_edge = lmsr.get("avgEdge", 0)
            brier_val = brier_mc.get("score")
            brier_str = f"{brier_val:.4f}" if brier_val is not None else "building"

            # Module count
            active_mods = sum(1 for l in [4,4,4,4,4,4,5,6,5,8,10,10,15,100] if level >= l)

            lines = [
                f"╔══════════════════════════════╗",
                f"║ CERTIFICATION [{cert_bar}] {cert_score}%",
                f"║ Status: {cert_status}",
                f"╠══════════════════════════════╣",
                f"║ Human: {top_state.replace('_',' ')}",
                f"║ Poly Blocks: {poly_blocks}",
                f"║ LMSR Edge: {lmsr_edge}%",
                f"║ Brier: {brier_str}",
                f"║ Modules: {active_mods}/14 active",
                f"╠══════════════════════════════╣",
                f"║ Session: {'ACTIVE' if opens else 'MONITORING'}",
                f"║ Circuit: ARMED",
                f"║ Apoptosis: {'ACTIVE' if level >= 10 else 'LVL 10+'}",
                f"╚══════════════════════════════╝",
            ]
            mc_body.update("\n".join(lines))
        except NoMatches:
            pass

        # ── Price Ticker ──
        ticker_map = {"btc": "BTCUSDT", "eth": "ETHUSDT", "sol": "SOLUSDT", "bnb": "BNBUSDT", "xrp": "XRPUSDT"}
        for sym, key in ticker_map.items():
            try:
                p = prices.get(key, {})
                price = p.get("price", 0)
                chg = p.get("change", 0)
                icon = "▲" if chg > 0 else "▼" if chg < 0 else "●"
                el = self.query_one(f"#tk-{sym}", Static)
                el.update(f"{sym.upper()}: ${price:,.2f} {icon}{chg:+.1f}%")
                el.styles.color = "#00ff88" if chg > 0 else "#ff4444" if chg < 0 else "#888"
            except (NoMatches, Exception):
                pass

    # ── Actions ──
    def action_force_refresh(self) -> None:
        self.refresh_data()

    def action_toggle_pause(self) -> None:
        self.paused = not self.paused
        try:
            status = self.query_one("#topbar-status", Static)
            if self.paused:
                status.update("⏸ PAUSED — press [P] to resume")
            else:
                status.update("● RESUMED")
        except NoMatches:
            pass

    def action_toggle_mc(self) -> None:
        """Toggle Mother Code panel visibility."""
        try:
            mc = self.query_one("#mother-code-panel")
            mc.display = not mc.display
        except NoMatches:
            pass

    def action_zoom_1(self) -> None:
        self._zoom_panel(0)

    def action_zoom_2(self) -> None:
        self._zoom_panel(1)

    def action_zoom_3(self) -> None:
        self._zoom_panel(2)

    def _zoom_panel(self, idx: int) -> None:
        """Toggle zoom on a specific panel."""
        for i in range(3):
            try:
                panel = self.query_one(f"#panel-{i}", PositionPanel)
                if i == idx:
                    panel.display = True
                    panel.styles.width = "100%" if panel.styles.width != "100%" else "1fr"
                else:
                    panel.display = panel.styles.width != "100%"
            except NoMatches:
                pass


if __name__ == "__main__":
    app = AdanTUI()
    app.run()
