function updateNeuralFlow(d) {
    const wrap = document.getElementById('nf-wrap');
    if (!wrap) return;
    const isThinking = d.state?.mode === 'thinking';
    const isDone = d.state?.mode === 'result';

    const prices = d.state?.prices || {};
    const btc = prices['BTCUSDT'];

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const frame = frames[Math.floor(Date.now() / 150) % frames.length];
    const fmt = (v, dp = 2) => v != null ? v.toFixed(dp) : '--';
    const chgTxt = (p) => p ? (p.chg >= 0 ? '+' : '') + fmt(p.chg, 1) + '%' : '--';

    const C_CARD = '#ddd9cc';
    const C_CARD3 = '#e8e4d8';
    const C_BRD2 = '#3a3a2a';
    const C_TXT = '#1a1a1a';
    const C_DIM = '#888878';
    const C_SHD = '#1a1a1a';
    const C_CYA = '#1a4a8a';
    const C_GRN = '#1a5a1a';
    const C_PUR = '#5a1a8a';
    const C_YEL = '#7a5a10';
    const C_RED = '#8a1a1a';

    const lnColor = isThinking ? C_CYA : isDone ? C_GRN : C_BRD2;

    const SVG_W = 1000, SVG_H = 450;
    const CX = SVG_W / 2, CY = SVG_H / 2;
    const ORBIT_R = 150;
    const ADAN_R = 40;
    const PARENT_R = 30;

    const children = d.children || [];
    const appleIntel = children.find(c => c.spec === 'apple');
    const snakeIntel = children.find(c => c.spec === 'snake');
    const evaIntel = children.find(c => c.spec === 'eva');
    const atlasIntel = children.find(c => c.spec === 'atlas');

    const parentDefs = [
        { id: 'apple', name: 'APPLE', icon: '🍎', color: C_YEL, angle: -45, intel: appleIntel, l1: appleIntel?.report?.opportunity || 'scanning...', l2: appleIntel ? 'F&G:' + (appleIntel.report?.fgValue ?? '--') : 'waiting' },
        { id: 'snake', name: 'SNAKE', icon: '🐍', color: C_GRN, angle: 45, intel: snakeIntel, l1: snakeIntel?.report?.viability || 'scanning...', l2: snakeIntel ? 'Vol:' + (snakeIntel.report?.avgVolRatio ?? '--') + 'x' : 'waiting' },
        { id: 'eva', name: 'EVA', icon: '👑', color: C_RED, angle: 135, intel: evaIntel, l1: evaIntel?.report?.approved ? 'APPROVED' : (evaIntel ? 'DENIED' : 'scanning...'), l2: evaIntel ? 'Risk:' + (evaIntel.report?.riskLevel || '--') : 'waiting' },
        { id: 'atlas', name: 'ATLAS', icon: '👁️‍🗨️', color: C_PUR, angle: -135, intel: atlasIntel, l1: atlasIntel?.report?.smartMoney || 'scanning...', l2: atlasIntel ? 'Funding:' + (atlasIntel.report?.fundingRate || '--') : 'waiting' }
    ];

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_W} ${SVG_H}" style="width:100%;height:${SVG_H}px">
  <defs>
    <marker id="arh-rad" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="${lnColor}"/>
    </marker>
    <radialGradient id="adan-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${C_PUR}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${C_PUR}" stop-opacity="0"/>
    </radialGradient>
  </defs>`;

    svg += `<circle cx="${CX}" cy="${CY}" r="${ORBIT_R}" fill="none" stroke="${C_BRD2}" stroke-width="1" stroke-dasharray="4 4" opacity="0.3"/>`;

    parentDefs.forEach((p, i) => {
        const rad = p.angle * Math.PI / 180;
        const px = CX + ORBIT_R * Math.cos(rad);
        const py = CY + ORBIT_R * Math.sin(rad);
        const distC = Math.sqrt(Math.pow(CX - px, 2) + Math.pow(CY - py, 2));
        const x1 = px + (CX - px) / distC * PARENT_R;
        const y1 = py + (CY - py) / distC * PARENT_R;
        const x2 = CX - (CX - px) / distC * ADAN_R;
        const y2 = CY - (CY - py) / distC * ADAN_R;
        const lineOpacity = Math.max(0.3, Math.min(1, (p.intel?.signal?.conf || 30) / 100));
        const ptDur = isThinking ? '0.5s' : '1.5s';

        svg += `<path d="M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}" stroke="${p.color}" stroke-width="1.5" stroke-dasharray="4 3" fill="none" opacity="${lineOpacity}" marker-end="url(#arh-rad)"/>`;
        for (let pt = 0; pt < 5; pt++) {
            svg += `<circle r="2" fill="${p.color}" opacity="${lineOpacity * (1 - pt / 10)}">
        <animateMotion path="M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}" dur="${ptDur}" begin="${pt * 0.3}s" repeatCount="indefinite"/>
      </circle>`;
        }
    });

    svg += `<circle cx="${CX}" cy="${CY}" r="${ADAN_R + 15}" fill="url(#adan-glow)"/>`;
    if (isThinking) {
        svg += `<circle cx="${CX}" cy="${CY}" r="${ADAN_R + 8}" fill="none" stroke="${C_CYA}" stroke-width="1.5" opacity=".3" class="nf-pulse"/>`;
    }

    const adanBorder = isThinking ? C_CYA : isDone ? C_GRN : C_PUR;
    svg += `<rect x="${CX - ADAN_R}" y="${CY - ADAN_R}" width="${ADAN_R * 2}" height="${ADAN_R * 2}" fill="${C_CARD}" stroke="${adanBorder}" stroke-width="2.5" onclick="showAdanDetail()" style="cursor:pointer"/>
  <text x="${CX}" y="${CY - 12}" text-anchor="middle" font-size="7" font-weight="700" fill="${C_PUR}" font-family="JetBrains Mono,monospace" letter-spacing="1.5">ADAN</text>
  <text x="${CX}" y="${CY + 4}" text-anchor="middle" font-size="18" fill="${isThinking ? C_CYA : C_PUR}" font-family="JetBrains Mono,monospace" font-weight="700">${isThinking ? frame : (isDone ? '◉' : '◈')}</text>
  <text x="${CX}" y="${CY + 18}" text-anchor="middle" font-size="8" fill="${C_DIM}" font-family="JetBrains Mono,monospace">${isThinking ? 'analyzing' : (isDone ? (d.state?.thought?.includes('BET') ? 'BET' : 'SKIP') : 'idle')}</text>`;

    const tSecGlobal = Date.now() / 1000;
    parentDefs.forEach((p) => {
        const rad = p.angle * Math.PI / 180;
        const px = CX + ORBIT_R * Math.cos(rad);
        const py = CY + ORBIT_R * Math.sin(rad);

        svg += `<g onclick="showParentDetail('${p.id}')" style="cursor:pointer">
      <rect x="${px - PARENT_R}" y="${py - PARENT_R}" width="${PARENT_R * 2}" height="${PARENT_R * 2}" fill="${C_CARD}" stroke="${p.color}" stroke-width="2"/>
      <text x="${px}" y="${py - 10}" text-anchor="middle" font-size="6.5" font-weight="700" fill="${p.color}" font-family="JetBrains Mono,monospace">${p.name}</text>
      <text x="${px}" y="${py + 2}" text-anchor="middle" font-size="12">${p.icon}</text>
    </g>`;

        const pChildren = children.filter(c => c.status !== 'dead' && (c.faction?.toLowerCase() === p.id || (c.name && c.name.toLowerCase().startsWith(p.id.charAt(0)))));
        const childOrbitR = PARENT_R + 35;
        if (pChildren.length > 0) {
            svg += `<circle cx="${px}" cy="${py}" r="${childOrbitR}" fill="none" stroke="${p.color}" stroke-width="0.5" stroke-dasharray="2 4" opacity="0.3"/>`;
        }

        pChildren.forEach((child, ci) => {
            const globalIdx = children.indexOf(child);
            const startAngle = (tSecGlobal % 16) / 16 * 360 + (ci / pChildren.length) * 360;
            svg += `<g transform="translate(${px}, ${py})">
        <g>
          <animateTransform attributeName="transform" type="rotate" from="${startAngle} 0 0" to="${startAngle + 360} 0 0" dur="16s" repeatCount="indefinite" />
          <g transform="translate(${childOrbitR}, 0)">
            <g>
              <animateTransform attributeName="transform" type="rotate" from="${-startAngle} 0 0" to="${-(startAngle + 360)} 0 0" dur="16s" repeatCount="indefinite" />
              <g onclick="showChildDetail(${globalIdx})" style="cursor:pointer;">
                <circle cx="0" cy="0" r="8" fill="${C_CARD3}" stroke="${C_CYA}" stroke-width="1.5" />
                <text x="0" y="2" text-anchor="middle" font-size="5" fill="${C_TXT}" font-family="JetBrains Mono,monospace">${(child.name || child.spec).slice(0, 3).toUpperCase()}</text>
              </g>
            </g>
          </g>
        </g>
      </g>`;
        });
    });

    svg += '</svg>';
    wrap.innerHTML = svg;

    const dot = document.getElementById('cmd-live-dot');
    const txt = document.getElementById('cmd-live-txt');
    if (dot) dot.className = 'cmd-live-dot' + (isThinking ? ' thinking' : (btc ? '' : ' idle'));
    if (txt) {
        txt.textContent = isThinking ? 'THINKING — Sonnet 4.6 analyzing' : isDone ? 'DECISION MADE' : (btc ? 'MONITORING · live prices' : 'INITIALIZING');
        txt.style.color = isThinking ? 'var(--cyan)' : isDone ? 'var(--green)' : 'var(--text2)';
    }
}
