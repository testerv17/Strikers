/* Strikers · Modo dueño: analítica de visitas, clientes, partidos y cupones */
(function () {
  const { esc, tierFor, cardPos, fmtTime, fmtDate, fmtDay } = window.SK;
  const C = window.STRIKERS_CONFIG;
  const root = document.getElementById('adm');
  const sheetRoot = document.getElementById('sheetRoot');
  const ADMIN_PIN = String(C.DEMO_ADMIN_PIN || '0000');

  const DAY = 864e5, TZ = 'America/Monterrey';
  const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const DOW_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];            // semana de lunes a domingo
  const ACTIVE_DAYS = 21, RISK_DAYS = 45;          // umbrales de segmento

  const T = { tab: 'sum', period: 30, data: null, M: null, filter: 'all', sort: 'since', q: '', sheet: null, pin: '', busy: false, sig: '' };

  /* ---------- utilidades ---------- */
  const fmtParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
  const WK = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const cache = new Map();
  function parts(iso) {
    let r = cache.get(iso);
    if (!r) { const p = {}; fmtParts.formatToParts(new Date(iso)).forEach(x => { p[x.type] = x.value; }); r = { dow: WK[p.weekday], hour: (+p.hour) % 24 }; cache.set(iso, r); }
    return r;
  }
  const h12 = h => `${h % 12 || 12} ${h % 24 < 12 ? 'am' : 'pm'}`;
  const since = d => d === null ? 'sin visitas' : d <= 0 ? 'hoy' : d === 1 ? 'ayer' : d < 60 ? `hace ${d} días` : `hace ${Math.round(d / 30)} meses`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const first = n => (n || 'Cliente').trim().split(/\s+/)[0];
  const waPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '52' + d : d; };
  const SEG = { active: 'Activo', risk: 'En riesgo', lost: 'Inactivo', none: 'Sin visitas' };

  /* ---------- modelo analítico ---------- */
  function model() {
    const D = T.data, now = Date.now(), P = T.period, start = now - P * DAY, prevStart = now - 2 * P * DAY;
    const byId = new Map();
    const customers = D.customers.map(c => {
      const o = { ...c, vs: [], coupons: [] }; byId.set(c.id, o); return o;
    });
    D.visits.forEach(v => { const c = byId.get(v.customer_id); if (c) c.vs.push(Date.parse(v.created_at)); });
    D.coupons.forEach(cp => { const c = byId.get(cp.customer_id); if (c) c.coupons.push(cp); });
    customers.forEach(c => {
      c.vs.sort((a, b) => a - b);
      c.first = c.vs.length ? c.vs[0] : null;
      c.last = c.vs.length ? c.vs[c.vs.length - 1] : null;
      c.gap = c.vs.length > 1 ? (c.last - c.first) / (c.vs.length - 1) / DAY : null;
      c.since = c.last === null ? null : Math.floor((now - c.last) / DAY);
      c.seg = c.since === null ? 'none' : c.since <= ACTIVE_DAYS ? 'active' : c.since <= RISK_DAYS ? 'risk' : 'lost';
      c.isNew = c.first !== null && c.first >= now - 14 * DAY;
      c.pos = cardPos(c.visits_total);
      c.tier = tierFor(c.visits_total);
    });

    const vt = D.visits.map(v => ({ t: Date.parse(v.created_at), c: v.customer_id, p: parts(v.created_at) }));
    const cur = vt.filter(v => v.t >= start), prev = vt.filter(v => v.t >= prevStart && v.t < start);
    const activeCur = new Set(cur.map(v => v.c)).size, activePrev = new Set(prev.map(v => v.c)).size;
    const newCur = customers.filter(c => c.first !== null && c.first >= start).length;

    // día de la semana: promedio por ocurrencia del día en el periodo (compara justo)
    const occ = Array(7).fill(0), tot = Array(7).fill(0);
    for (let i = 0; i < P; i++) occ[parts(new Date(now - i * DAY).toISOString()).dow]++;
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0)), hourTot = Array(24).fill(0);
    cur.forEach(v => { tot[v.p.dow]++; heat[v.p.dow][v.p.hour]++; hourTot[v.p.hour]++; });
    const avg = tot.map((n, d) => (occ[d] ? n / occ[d] : 0));

    const weeks = Array(12).fill(0);
    vt.forEach(v => { const i = Math.floor((now - v.t) / (7 * DAY)); if (i >= 0 && i < 12) weeks[11 - i]++; });

    // segmentos y retención
    const cnt = s => customers.filter(c => c.seg === s).length;
    const cohort = customers.filter(c => c.first !== null && c.first <= now - 14 * DAY);
    const retention = pct(cohort.filter(c => c.vs.length >= 2).length, cohort.length);
    const near = customers.filter(c => c.seg === 'active' && (c.pos === 4 || c.pos === 9));
    const oneTime = customers.filter(c => c.vs.length === 1 && c.first <= now - 14 * DAY).length;
    const valuable = customers.filter(c => (c.seg === 'risk' || c.seg === 'lost') && c.visits_total >= 3)
      .sort((a, b) => b.visits_total - a.visits_total || a.since - b.since).slice(0, 6);

    // cupones
    const cps = D.coupons;
    const expired = cps.filter(c => c.status === 'active' && Date.parse(c.expires_at) < now).length;
    const activeCp = cps.filter(c => c.status === 'active' && Date.parse(c.expires_at) >= now).length;
    const redeemed = cps.filter(c => c.status === 'redeemed').length;
    const redeemedCur = cps.filter(c => c.status === 'redeemed' && c.redeemed_at && Date.parse(c.redeemed_at) >= start).length;

    const M = {
      customers, byId, now, P,
      kpi: { visits: cur.length, visitsPrev: prev.length, active: activeCur, activePrev, newCur, retention, cohort: cohort.length,
        risk: cnt('risk'), lost: cnt('lost'), redeemedCur, perActive: activeCur ? cur.length / activeCur : 0 },
      avg, occ, tot, heat, hourTot, weeks, near, valuable, oneTime,
      cp: { total: cps.length, redeemed, active: activeCp, expired, rate: pct(redeemed, cps.length) },
      recent: [...D.visits].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 8)
    };
    M.insights = insights(M);
    return M;
  }

  function insights(M) {
    const k = M.kpi, out = [];
    if (k.visits > 0) {
      const days = ORDER.filter(d => M.occ[d] > 0);
      const best = days.reduce((a, b) => (M.avg[b] > M.avg[a] ? b : a));
      const worst = days.reduce((a, b) => (M.avg[b] < M.avg[a] ? b : a));
      out.push({ tone: 'good', html: `Tu día más fuerte es el <b>${DOW_FULL[best]}</b> (${M.avg[best].toFixed(1)} visitas en promedio). El más flojo es el <b>${DOW_FULL[worst]}</b> (${M.avg[worst].toFixed(1)}): buen candidato para una promoción o un evento.` });
      let bw = 0, bs = 0;
      for (let h = 0; h < 23; h++) { const s = M.hourTot[h] + M.hourTot[h + 1]; if (s > bs) { bs = s; bw = h; } }
      out.push({ tone: 'info', html: `La hora pico va de <b>${h12(bw)} a ${h12(bw + 2)}</b>: concentra ${pct(bs, k.visits)}% de las visitas. Ahí conviene reforzar personal.` });
      if (k.visitsPrev > 0) {
        const d = pct(k.visits - k.visitsPrev, k.visitsPrev);
        out.push({ tone: d >= 0 ? 'good' : 'warn', html: `En los últimos ${M.P} días hubo <b>${k.visits}</b> visitas, ${d === 0 ? 'lo mismo' : d > 0 ? 'un ' + d + '% más' : 'un ' + Math.abs(d) + '% menos'} que en los ${M.P} anteriores (${k.visitsPrev}).` });
      }
    }
    if (k.risk + k.lost > 0) out.push({ tone: 'warn', html: `<b>${k.risk}</b> clientes llevan entre ${ACTIVE_DAYS + 1} y ${RISK_DAYS} días sin venir y <b>${k.lost}</b> más de ${RISK_DAYS}. Revisa la lista de clientes valiosos en riesgo y escríbeles por WhatsApp.` });
    if (M.oneTime) out.push({ tone: 'warn', html: `<b>${M.oneTime}</b> clientes vinieron una sola vez hace más de 2 semanas y no han regresado. Una invitación para volver por su siguiente sello puede recuperarlos.` });
    if (M.near.length) out.push({ tone: 'good', html: `<b>${M.near.length}</b> clientes activos están a una visita de su cupón. Un mensaje esta semana puede convertirse en visita.` });
    if (k.cohort >= 5) out.push({ tone: k.retention >= 50 ? 'good' : 'warn', html: `De los clientes que llegaron hace más de 2 semanas, <b>${k.retention}%</b> ya regresó al menos una vez.` });
    if (M.cp.total) out.push({ tone: 'info', html: `Se ha canjeado <b>${M.cp.rate}%</b> de los cupones emitidos; ${M.cp.expired} vencieron sin usarse.` });
    return out;
  }

  /* ---------- gráficas ---------- */
  function bars(items) {
    const max = Math.max(...items.map(i => i.v), 1);
    return `<div class="bars">${items.map(i => `<div class="bar${i.hi ? ' hi' : ''}${i.lo ? ' lo' : ''}"><span class="bv">${i.t}</span><div class="col"><div class="bb" style="height:${Math.max(3, (i.v / max) * 100)}%"></div></div><span class="bl">${i.l}</span></div>`).join('')}</div>`;
  }

  function weekdayChart(M) {
    const days = ORDER.filter(d => M.occ[d] > 0), hi = days.reduce((a, b) => (M.avg[b] > M.avg[a] ? b : a), days[0]), lo = days.reduce((a, b) => (M.avg[b] < M.avg[a] ? b : a), days[0]);
    return bars(ORDER.map(d => ({ l: DOW[d], v: M.avg[d], t: M.avg[d] ? M.avg[d].toFixed(1) : '0', hi: d === hi, lo: d === lo })));
  }
  function weeksChart(M) {
    return bars(M.weeks.map((n, i) => ({ l: i === 11 ? 'Ahora' : i % 3 === 0 ? `-${11 - i}s` : '', v: n, t: n, hi: i === 11 })));
  }
  function heatChart(M) {
    let hs = []; for (let h = 0; h < 24; h++) if (M.hourTot[h] > 0) hs.push(h);
    if (!hs.length) return '<p class="empty">Sin visitas en el periodo.</p>';
    const from = Math.min(...hs), to = Math.max(...hs), H = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    const max = Math.max(...M.heat.flat(), 1);
    const head = `<span></span>${H.map(h => `<span class="hl">${h % 12 || 12}${h < 12 ? 'a' : 'p'}</span>`).join('')}`;
    const rows = ORDER.map(d => `<span class="hd">${DOW[d]}</span>${H.map(h => { const v = M.heat[d][h]; return `<i style="background:${v ? `rgba(255,194,14,${(0.1 + 0.9 * v / max).toFixed(2)})` : 'rgba(255,255,255,.04)'}" title="${DOW[d]} ${h12(h)}: ${v} visitas"></i>`; }).join('')}`).join('');
    return `<div class="heat" style="grid-template-columns:34px repeat(${H.length},minmax(0,1fr))">${head}${rows}</div>`;
  }

  /* ---------- pestañas ---------- */
  const dl = (cur, prev) => (prev === 0 ? '' : cur === prev ? '<span class="dl">igual</span>' : `<span class="dl ${cur >= prev ? 'up' : 'down'}">${cur >= prev ? '▲' : '▼'} ${Math.abs(pct(cur - prev, prev))}%</span>`);
  const kpi = (n, label, extra = '') => `<div class="kpi"><b>${n}</b><small>${label}</small>${extra}</div>`;

  function sumHTML(M) {
    const k = M.kpi;
    const chips = [7, 30, 90].map(p => `<button class="chip2${T.period === p ? ' on' : ''}" data-a="period" data-p="${p}">${p} días</button>`).join('');
    const valuable = M.valuable.length ? M.valuable.map(c => `<button class="crow" data-a="cust" data-id="${esc(c.id)}"><span class="av">${esc((c.name || '?')[0].toUpperCase())}</span>
        <div class="cm"><b>${esc(c.name || 'Cliente')}</b><span>${c.visits_total} visitas · ${esc(c.tier)}</span></div><div class="cr"><b class="seg-${c.seg}">${since(c.since)}</b><span>${SEG[c.seg]}</span></div></button>`).join('')
      : '<p class="empty">Ningún cliente con historial está en riesgo. ¡Bien!</p>';
    const recent = M.recent.map(v => { const c = M.byId.get(v.customer_id); return `<div class="ev"><span class="ev-i v">✓</span><div><b>${esc((c && c.name) || 'Cliente')}</b><span>${fmtDay(v.created_at)} ${fmtDate(v.created_at)}</span></div><time>${fmtTime(v.created_at)}</time></div>`; }).join('');
    return `<div class="periodbar"><span class="mute">Periodo</span>${chips}</div>
      <div class="kpis">
        ${kpi(k.visits, 'Visitas', dl(k.visits, k.visitsPrev))}
        ${kpi(k.active, 'Clientes activos', dl(k.active, k.activePrev))}
        ${kpi(k.newCur, 'Clientes nuevos')}
        ${kpi(k.cohort >= 5 ? k.retention + '%' : '—', 'Regresan (retención)')}
        ${kpi(k.risk, `En riesgo (${ACTIVE_DAYS + 1}–${RISK_DAYS} días)`, k.risk ? '<span class="dl down">atender</span>' : '')}
        ${kpi(k.lost, `Inactivos (+${RISK_DAYS} días)`)}
        ${kpi(k.redeemedCur, 'Cupones canjeados')}
        ${kpi(k.perActive.toFixed(1), 'Visitas por cliente activo')}
      </div>
      <div class="cards">
        <section class="cardx wide"><h3 class="display">Qué te dicen los datos</h3>${M.insights.length ? M.insights.map(i => `<div class="ins ${i.tone}"><i></i><p>${i.html}</p></div>`).join('') : '<p class="empty">Aún no hay visitas suficientes en este periodo.</p>'}</section>
        <section class="cardx"><h3 class="display">Visitas por día <small>promedio por día</small></h3>${weekdayChart(M)}</section>
        <section class="cardx"><h3 class="display">Tendencia <small>visitas por semana, 12 semanas</small></h3>${weeksChart(M)}</section>
        <section class="cardx wide"><h3 class="display">Mapa de calor <small>día y hora, últimos ${M.P} días</small></h3>${heatChart(M)}</section>
        <section class="cardx"><h3 class="display">Clientes valiosos en riesgo <small>los que más venían y dejaron de venir</small></h3>${valuable}</section>
        <section class="cardx"><h3 class="display">Últimas visitas</h3>${recent || '<p class="empty">Sin visitas todavía.</p>'}</section>
      </div>`;
  }

  /* --- clientes --- */
  const FILTERS = [['all', 'Todos'], ['active', 'Activos'], ['risk', 'En riesgo'], ['lost', 'Inactivos'], ['new', 'Nuevos'], ['near', 'A 1 visita del cupón'], ['titular', 'Titular'], ['mvp', 'MVP']];
  const matchFilter = (c, f) => f === 'all' || (f === 'new' ? c.isNew : f === 'near' ? (c.pos === 4 || c.pos === 9) : f === 'titular' ? c.tier === 'Titular' : f === 'mvp' ? c.tier === 'MVP' : c.seg === f);

  function custRows(M) {
    const q = T.q.trim().toLowerCase();
    let list = M.customers.filter(c => matchFilter(c, T.filter) && (!q || (c.name || '').toLowerCase().includes(q) || (c.customer_code || '').toLowerCase().includes(q) || String(c.phone || '').includes(q)));
    const big = 1e9;
    list.sort(T.sort === 'visits' ? (a, b) => b.visits_total - a.visits_total : T.sort === 'recent' ? (a, b) => (a.since ?? big) - (b.since ?? big) : (a, b) => (b.since ?? -1) - (a.since ?? -1));
    if (!list.length) return '<p class="empty">Sin resultados.</p>';
    return `<p class="mute sm" style="margin-bottom:4px">${list.length} clientes</p>` + list.slice(0, 200).map(c => `<button class="crow" data-a="cust" data-id="${esc(c.id)}"><span class="av">${esc((c.name || '?')[0].toUpperCase())}</span>
      <div class="cm"><b>${esc(c.name || 'Sin nombre')}</b><span>${esc(c.customer_code)} · ${esc(c.tier)}${c.gap ? ` · cada ${Math.round(c.gap)} días` : ''}</span></div>
      <div class="cr"><b class="seg-${c.seg}">${since(c.since)}</b><span>${c.visits_total} visitas</span></div></button>`).join('');
  }
  function custHTML(M) {
    const n = f => M.customers.filter(c => matchFilter(c, f)).length;
    return `<div class="toolbar"><input id="q" class="field" placeholder="Buscar por nombre, código o teléfono" value="${esc(T.q)}" autocomplete="off">
        <select id="sort" class="field" aria-label="Ordenar"><option value="since"${T.sort === 'since' ? ' selected' : ''}>Más tiempo sin venir</option><option value="recent"${T.sort === 'recent' ? ' selected' : ''}>Vinieron más recientemente</option><option value="visits"${T.sort === 'visits' ? ' selected' : ''}>Más visitas</option></select></div>
      <div class="chips2">${FILTERS.map(([k, l]) => `<button class="chip2${T.filter === k ? ' on' : ''}" data-a="filter" data-f="${k}">${l} <em>${n(k)}</em></button>`).join('')}</div>
      <div id="clist">${custRows(M)}</div>`;
  }

  /* --- partidos --- */
  function matchesHTML(M) {
    const D = T.data, now = Date.now();
    const up = D.matches.filter(m => Date.parse(m.starts_at) >= now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const rows = up.map(m => {
      const rs = D.reservations.filter(r => r.match_id === m.id);
      const names = rs.map(r => first((M.byId.get(r.customer_id) || {}).name));
      const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ` y ${names.length - 6} más` : '');
      return `<div class="mrow"><div><b>${esc(m.title)}</b><span>${fmtDay(m.starts_at)} ${fmtDate(m.starts_at)} · ${fmtTime(m.starts_at)}</span>
        ${m.mvp_first ? `<em class="tag">MVP primero${m.opens_at ? ' · abre ' + fmtDay(m.opens_at).toLowerCase() : ''}</em>` : ''}
        <span class="mute sm">${rs.length ? esc(shown) : 'Sin reservas todavía'}</span></div>
        <div class="mr"><b>${rs.length}</b><span>reservas</span><button class="link" data-a="delMatch" data-id="${esc(m.id)}">Quitar</button></div></div>`;
    }).join('');
    return `<div class="cards"><section class="cardx"><h3 class="display">Próximos partidos</h3>${rows || '<p class="empty">No hay partidos programados.</p>'}</section>
      <section class="cardx"><h3 class="display">Agregar partido</h3>
        <label class="lbl" for="mt">Nombre</label><input id="mt" class="field" placeholder="Ej. Clásico de fútbol" maxlength="60">
        <label class="lbl" for="md" style="margin-top:12px">Fecha y hora</label><input id="md" class="field" type="datetime-local">
        <label class="chk"><input type="checkbox" id="mm"> Partido grande: los MVP reservan primero (abre 2 días antes para los demás)</label>
        <p class="err" id="err" role="alert"></p><button class="btn" data-a="addMatch">Agregar partido</button></section></div>`;
  }

  /* --- cupones --- */
  function couponsHTML(M) {
    const D = T.data, now = Date.now(), c = M.cp;
    const st = x => x.status === 'redeemed' ? ['Canjeado', 'ok'] : Date.parse(x.expires_at) < now ? ['Vencido', 'bad'] : ['Vigente', 'y'];
    const list = [...D.coupons].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 60).map(x => {
      const [l, cl] = st(x), cu = M.byId.get(x.customer_id);
      return `<div class="ev"><span class="ev-i r">${x.discount}%</span><div><b>${esc((cu && cu.name) || 'Cliente')}</b><span>${esc(x.code)} · emitido ${fmtDate(x.created_at)}${x.status === 'redeemed' && x.redeemed_at ? ' · canjeado ' + fmtDate(x.redeemed_at) : ' · vence ' + fmtDate(x.expires_at)}</span></div><em class="st ${cl}">${l}</em></div>`;
    }).join('');
    return `<div class="kpis">${kpi(c.total, 'Cupones emitidos')}${kpi(c.redeemed, 'Canjeados', `<span class="dl up">${c.rate}%</span>`)}${kpi(c.active, 'Vigentes')}${kpi(c.expired, 'Vencidos sin usar')}</div>
      <div class="cards"><section class="cardx wide"><h3 class="display">Cupones recientes</h3>${list || '<p class="empty">Todavía no hay cupones.</p>'}</section></div>`;
  }

  /* ---------- hoja de detalle del cliente ---------- */
  function sheetHTML() {
    const c = T.sheet && T.M.byId.get(T.sheet);
    if (!c) return '';
    const near = c.seg === 'active' && (c.pos === 4 || c.pos === 9);
    const msg = near ? `Hola ${first(c.name)}, te falta 1 visita para tu cupón de ${c.pos === 4 ? 15 : 20}% en Strikers. ¡Te esperamos!`
      : `Hola ${first(c.name)}, te extrañamos en Strikers. Pásate esta semana y tu visita cuenta para tu próximo descuento.`;
    const vis = [...c.vs].reverse().slice(0, 8).map(t => { const iso = new Date(t).toISOString(); return `<div class="ev"><span class="ev-i v">✓</span><div><b>${fmtDay(iso)} ${fmtDate(iso)}</b></div><time>${fmtTime(iso)}</time></div>`; }).join('');
    const now = Date.now();
    const cps = c.coupons.map(x => `<span class="tag2">${x.discount}% · ${x.status === 'redeemed' ? 'canjeado' : Date.parse(x.expires_at) < now ? 'vencido' : 'vigente'}</span>`).join('');
    const wa = waPhone(c.phone);
    return `<div class="adm-sheet-wrap" data-a="backdrop"><div class="adm-sheet" role="dialog" aria-modal="true">
      <div class="who"><div class="avatar">${esc((c.name || '?')[0].toUpperCase())}</div><div><h3 class="display">${esc(c.name || 'Sin nombre')}</h3><span class="mute">${esc(c.customer_code)} · ${esc(c.tier)}</span></div></div>
      <div class="mini">
        <div><b>${c.visits_total}</b><span>visitas</span></div>
        <div><b class="seg-${c.seg}">${since(c.since)}</b><span>${SEG[c.seg]}</span></div>
        <div><b>${c.gap ? Math.round(c.gap) + ' d' : '—'}</b><span>entre visitas</span></div>
        <div><b>${c.first ? fmtDate(new Date(c.first).toISOString()) : '—'}</b><span>primera visita</span></div>
      </div>
      ${cps ? `<div class="tags">${cps}</div>` : ''}
      ${wa ? `<a class="btn wa" href="https://wa.me/${wa}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Escribir por WhatsApp</a>` : ''}
      <h4 class="display s-sub" style="margin:8px 0 0">Últimas visitas</h4>${vis || '<p class="empty">Sin visitas registradas.</p>'}
      <button class="link center-l" data-a="closeSheet">Cerrar</button></div></div>`;
  }

  /* ---------- vistas principales ---------- */
  const head = right => `<header class="adm-head"><div class="adm-brand"><h1 class="logo">STRIKERS</h1><span class="pill">Dueño</span></div>${right || ''}</header>`;
  const setErr = m => { const el = root.querySelector('#err'); if (el) el.textContent = m || ''; };

  function pinView() {
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-a="key" data-k="${k}">${k}</button>`).join('');
    root.innerHTML = `<div class="adm-login">${head()}<h2 class="display big">Ingresa tu PIN</h2><p class="lead sm">Acceso del dueño.</p>
      <div class="otp" id="pinbox">${Array.from({ length: ADMIN_PIN.length }, (_, i) => `<i class="${i === 0 ? 'cur' : ''}"></i>`).join('')}</div>
      <p class="err" id="err" role="alert"></p><p class="demo-tag static">Modo demo · PIN: ${esc(ADMIN_PIN)}</p>
      <div class="pad">${keys}<button class="z" data-a="key" data-k="0">0</button><button data-a="del" aria-label="Borrar">⌫</button></div></div>`;
  }
  function updatePin() { root.querySelectorAll('#pinbox i').forEach((el, i) => { el.textContent = T.pin[i] ? '•' : ''; el.className = i === T.pin.length ? 'cur' : ''; }); }
  async function pinKey(k) {
    if (T.busy || T.pin.length >= ADMIN_PIN.length) return;
    T.pin += k; updatePin(); setErr('');
    if (T.pin.length === ADMIN_PIN.length) {
      T.busy = true;
      try { await API.adminLogin(T.pin); T.pin = ''; await start(); }
      catch (e) { T.pin = ''; updatePin(); setErr(e.message || 'PIN incorrecto'); const o = root.querySelector('#pinbox'); if (o) { o.classList.remove('shake'); void o.offsetWidth; o.classList.add('shake'); } }
      finally { T.busy = false; }
    }
  }
  function emailView() {
    root.innerHTML = `<div class="adm-login">${head()}<h2 class="display big">Entrar</h2>
      <label class="lbl" for="em">Correo</label><input id="em" class="field" type="email" autocomplete="username">
      <label class="lbl" for="pw" style="margin-top:12px">Contraseña</label><input id="pw" class="field" type="password" autocomplete="current-password">
      <p class="err" id="err" role="alert"></p><button class="btn" data-a="login">Entrar</button></div>`;
  }
  const loginView = () => (API.demo ? pinView() : emailView());

  function mainView() {
    const M = T.M;
    const tabs = [['sum', 'Resumen'], ['cust', 'Clientes'], ['match', 'Partidos'], ['cup', 'Cupones']];
    const body = T.tab === 'sum' ? sumHTML(M) : T.tab === 'cust' ? custHTML(M) : T.tab === 'match' ? matchesHTML(M) : couponsHTML(M);
    root.innerHTML = `${head('<div class="adm-actions"><button class="link" data-a="refresh">Actualizar</button><button class="link" data-a="out">Salir</button></div>')}
      <nav class="adm-tabs">${tabs.map(([k, l]) => `<button class="adm-tab${T.tab === k ? ' on' : ''}" data-a="tab" data-t="${k}">${l}</button>`).join('')}</nav>${body}`;
    sheetRoot.innerHTML = sheetHTML();
  }

  const sig = D => [D.customers.length, D.visits.length, D.coupons.length, D.coupons.filter(c => c.status === 'redeemed').length, D.matches.length, D.reservations.length].join('-');
  async function load(force) {
    T.data = await API.ownerData();
    const s = sig(T.data);
    if (!force && s === T.sig) return false;
    T.sig = s; T.M = model(); return true;
  }
  async function start() {
    try { await load(true); mainView(); } catch (e) { root.innerHTML = `<div class="adm-login">${head()}<p class="err">No se pudieron cargar los datos: ${esc(e.message || e)}</p><button class="btn" data-a="out">Salir</button></div>`; }
  }

  /* ---------- acciones ---------- */
  const A = {
    key: el => pinKey(el.dataset.k),
    del: () => { T.pin = T.pin.slice(0, -1); updatePin(); },
    async login() { try { await API.adminLogin(root.querySelector('#em').value.trim(), root.querySelector('#pw').value); await start(); } catch (e) { setErr(e.message || 'No se pudo entrar'); } },
    async out() { await API.adminSignOut(); T.data = null; T.sig = ''; T.sheet = null; sheetRoot.innerHTML = ''; loginView(); },
    tab: el => { T.tab = el.dataset.t; mainView(); },
    period: el => { T.period = +el.dataset.p; T.M = model(); mainView(); },
    filter: el => { T.filter = el.dataset.f; mainView(); },
    cust: el => { T.sheet = el.dataset.id; sheetRoot.innerHTML = sheetHTML(); },
    closeSheet: () => { T.sheet = null; sheetRoot.innerHTML = ''; },
    backdrop: () => { },
    async refresh() { await load(true); mainView(); },
    async addMatch() {
      const title = root.querySelector('#mt').value.trim(), val = root.querySelector('#md').value, mvp = root.querySelector('#mm').checked;
      if (title.length < 2) return setErr('Escribe el nombre del partido.');
      if (!val) return setErr('Elige la fecha y la hora.');
      const start = new Date(val);
      if (start < new Date()) return setErr('La fecha ya pasó.');
      let opens = null;
      if (mvp) { opens = new Date(start); opens.setDate(opens.getDate() - 2); opens.setHours(0, 0, 0, 0); }
      try { await API.ownerSaveMatch({ title, starts_at: start.toISOString(), mvp_first: mvp, opens_at: opens ? opens.toISOString() : null }); await load(true); mainView(); }
      catch (e) { setErr(e.message || 'No se pudo guardar'); }
    },
    async delMatch(el) {
      if (!confirm('¿Quitar este partido y sus reservas?')) return;
      try { await API.ownerDeleteMatch(el.dataset.id); await load(true); mainView(); } catch (e) { alert(e.message || 'No se pudo quitar'); }
    }
  };
  function dispatch(e) { const el = e.target.closest('[data-a]'); if (el && A[el.dataset.a] && !el.disabled) A[el.dataset.a](el); }
  root.addEventListener('click', dispatch);
  sheetRoot.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (el && el.dataset.a !== 'backdrop') dispatch(e); });
  root.addEventListener('input', e => { if (e.target.id === 'q') { T.q = e.target.value; root.querySelector('#clist').innerHTML = custRows(T.M); } });
  root.addEventListener('change', e => { if (e.target.id === 'sort') { T.sort = e.target.value; root.querySelector('#clist').innerHTML = custRows(T.M); } });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'pw') A.login(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && T.sheet) return A.closeSheet();
    if (!API.demo || !root.querySelector('#pinbox')) return;
    if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') A.del();
  });

  // Actualización automática cada 15 s (sin interrumpir si hay hoja abierta o se está escribiendo)
  setInterval(async () => {
    if (!T.data || document.hidden || T.sheet) return;
    const ae = document.activeElement;
    if (ae && ['INPUT', 'SELECT', 'TEXTAREA'].includes(ae.tagName)) return;
    try { if (await load(false)) mainView(); } catch (e) { /* red intermitente */ }
  }, 15000);

  (async function init() {
    try { (await API.adminSession()) ? await start() : loginView(); } catch (e) { loginView(); }
  })();
})();
