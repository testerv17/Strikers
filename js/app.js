/* Strikers · App del cliente (SPA sin framework) */
(function () {
  const { tierFor, cardPos, esc, fmtDay, fmtTime, fmtDate, drawQR, icons, football } = window.SK;
  const C = window.STRIKERS_CONFIG;
  const app = document.getElementById('app');
  const channelName = C.OTP_CHANNEL === 'whatsapp' ? 'WhatsApp' : 'SMS';

  // Link de invitación: ?ref=CARLOS-STK7
  const refParam = new URLSearchParams(location.search).get('ref');
  if (refParam) localStorage.setItem('strikers_ref', refParam.trim().toUpperCase());

  const S = {
    view: 'boot',        // boot | login | otp | name | main
    tab: 'card',         // card | coupons | matches | level
    phone: '', code: '',
    profile: null, coupons: [], matches: [],
    layer: null,         // {type:'qr'} | {type:'coupon', code}
    td: null,            // cupón recién ganado (modal ¡Touchdown!)
    countdown: 0, timer: null, pop: false, busy: false
  };

  /* ---------- helpers ---------- */
  const SEEN = 'strikers_seen_coupons';
  const getSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN) || '[]'); } catch { return []; } };
  const markSeen = code => { const s = getSeen(); if (!s.includes(code)) { s.push(code); localStorage.setItem(SEEN, JSON.stringify(s)); } };
  const firstName = n => (n || '').trim().split(/\s+/)[0];
  const digits = v => String(v || '').replace(/\D/g, '').slice(0, 10);
  const fmtPhone = d => d.replace(/^(\d{0,2})(\d{0,4})(\d{0,4}).*/, (m, a, b, c) => [a, b, c].filter(Boolean).join(' '));
  const fmtCd = n => `0:${String(n).padStart(2, '0')}`;
  const friendly = e => (/token|otp|expired|invalid|incorrecto/i.test(e && e.message) ? 'Código incorrecto o vencido. Inténtalo de nuevo.' : (e && e.message) || 'Algo salió mal. Inténtalo de nuevo.');
  const $ = s => app.querySelector(s);
  const setErr = msg => { const el = $('#err'); if (el) el.textContent = msg || ''; };

  let toastT;
  function toast(msg) {
    let t = app.querySelector('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); app.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- datos ---------- */
  async function loadAll() {
    const [p, c, m] = await Promise.all([API.getProfile(), API.getCoupons(), API.getMatches()]);
    S.profile = p; S.coupons = c; S.matches = m;
    localStorage.removeItem('strikers_ref');
  }

  function checkTouchdown() {
    if (S.td || S.layer) return;
    const seen = getSeen();
    S.td = S.coupons.find(c => c.status === 'active' && !seen.includes(c.code)) || null;
  }

  async function refresh() {
    if (S.view !== 'main' || document.hidden || S.busy) return;
    try {
      const [p, c, m] = await Promise.all([API.getProfile(), API.getCoupons(), API.getMatches()]);
      if (JSON.stringify([p, c, m]) === JSON.stringify([S.profile, S.coupons, S.matches])) return;
      if (p.visits_total > S.profile.visits_total) S.pop = true;
      S.profile = p; S.coupons = c; S.matches = m;
      checkTouchdown();
      render();
      S.pop = false;
    } catch (e) { /* red intermitente: se reintenta en el siguiente ciclo */ }
  }
  setInterval(refresh, 4000);
  document.addEventListener('visibilitychange', refresh);

  /* ---------- vistas ---------- */
  const ballBg = `<svg class="ball-bg" viewBox="0 0 200 200" aria-hidden="true"><g transform="rotate(-35 100 100)" fill="none" stroke="#fff" stroke-width="6" opacity=".08" stroke-linecap="round"><ellipse cx="100" cy="100" rx="92" ry="56"/><path d="M58 100h84M78 76v48M100 76v48M122 76v48"/></g></svg>`;

  function demoChips() {
    if (!API.demo) return '';
    const chips = API.demoAccounts().map(a =>
      `<button class="chip" data-a="fillPhone" data-p="${a.phone}"><b>${esc(firstName(a.name))}</b><span>${tierFor(a.visits)} · ${a.visits} visitas</span></button>`).join('');
    return `<p class="chips-lbl">Cuentas de ejemplo: toca una para llenar el teléfono. Con otro número te registras como cliente nuevo.</p><div class="chips">${chips}</div>`;
  }

  function loginHTML() {
    return `<section class="screen login">
      <div><h1 class="logo">STRIKERS</h1><p class="sub">Sport bar</p></div>
      <div class="hero">
        <h2 class="display">Cada visita cuenta.</h2>
        <p class="lead">Junta 10 visitas y gana hasta 20% de descuento en tu consumo.</p>
      </div>
      <label for="phone" class="lbl">Tu teléfono</label>
      <input id="phone" class="field" inputmode="numeric" autocomplete="tel" placeholder="55 1234 5678" value="${esc(S.phone)}">
      <p class="err" id="err" role="alert"></p>
      <button class="btn" data-a="send" id="sendBtn">Enviar código</button>
      <p class="fine">Te mandamos un código por WhatsApp o SMS.<br>Si es tu primera vez, tu tarjeta se crea al validar tu número.</p>
      ${demoChips()}
      ${API.demo ? `<p class="demo-tag">Modo demo · código: ${esc(C.DEMO_OTP)} · <a href="staff.html">Acceso mesero</a></p>` : ''}
      ${ballBg}
    </section>`;
  }

  function otpHTML() {
    const len = API.otpLength;
    const boxes = Array.from({ length: len }, (_, i) => `<i class="${i === S.code.length ? 'cur' : ''}">${esc(S.code[i] || '')}</i>`).join('');
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-a="key" data-k="${k}">${k}</button>`).join('');
    return `<section class="screen otp">
      <button class="back" data-a="changeNumber" aria-label="Volver">${'‹'}</button>
      <h2 class="display big">Escribe tu código</h2>
      <p class="lead sm">Lo enviamos por ${channelName} al ${esc(S.phone)}.</p>
      <div class="otp" id="otp" aria-live="polite">${boxes}</div>
      <p class="err" id="err" role="alert"></p>
      ${S.countdown > 0
        ? `<p class="fine">Puedes pedir otro código en <span id="cd">${fmtCd(S.countdown)}</span></p>`
        : `<button class="link" data-a="resend">Reenviar código</button>`}
      <button class="link" data-a="changeNumber">Cambiar número</button>
      ${API.demo ? `<p class="demo-tag">Modo demo · código: ${esc(C.DEMO_OTP)}</p>` : ''}
      <div class="pad">${keys}<button class="z" data-a="key" data-k="0">0</button><button data-a="del" aria-label="Borrar">⌫</button></div>
    </section>`;
  }

  function nameHTML() {
    return `<section class="screen namev">
      <h2 class="display big">¿Cómo te llamas?</h2>
      <p class="lead sm">Así te saludamos en tu tarjeta.</p>
      <input id="name" class="field" maxlength="30" autocomplete="given-name" placeholder="Tu nombre">
      <p class="err" id="err" role="alert"></p>
      <button class="btn" data-a="saveName">Continuar</button>
    </section>`;
  }

  function progressHTML(v) {
    const pos = cardPos(v);
    const faltan = n => (n === 1 ? 'falta 1 visita' : `faltan ${n} visitas`);
    if (pos < 5) return `Vas en <b class="y">${pos} de 10</b>. Te ${faltan(5 - pos)} para tu 15% de descuento.`;
    if (pos < 10) return `Vas en <b class="y">${pos} de 10</b>. Te ${faltan(10 - pos)} para tu 20% de descuento.`;
    return `<b class="y">¡Tarjeta completa!</b> Ganaste tu 20%. Tu próxima visita empieza una tarjeta nueva.`;
  }

  function stampsHTML(v) {
    const pos = cardPos(v);
    return Array.from({ length: 10 }, (_, i) => {
      const n = i + 1, on = n <= pos;
      const badge = n === 5 ? '<span class="bd">15%</span>' : n === 10 ? '<span class="bd">20%</span>' : '';
      return `<div class="stamp${on ? ' on' : ''}${on && S.pop && n === pos ? ' pop' : ''}">${on ? football(30) : n}${badge}</div>`;
    }).join('');
  }

  function cardTab() {
    const p = S.profile, v = p.visits_total, nm = S.matches[0];
    const matchRow = nm
      ? `<div class="row"><div><small>Próximo partido</small><b>${esc(nm.title)}</b><span>${fmtDay(nm.starts_at)} · ${fmtTime(nm.starts_at)}</span></div>
          ${nm.reserved ? '<button class="btn sm outline-y" data-a="tab" data-t="matches">Reservada</button>' : '<button class="btn sm" data-a="tab" data-t="matches">Reservar mesa</button>'}</div>`
      : '';
    return `<header class="topbar"><h2 class="display">Hola, ${esc(firstName(p.name))}</h2><span class="pill">${tierFor(v)} · ${v} ${v === 1 ? 'visita' : 'visitas'}</span></header>
      <div class="card">
        <p class="kick">TARJETA DE</p><h3 class="ctitle">CLIENTE FRECUENTE</h3>
        <div class="stamps">${stampsHTML(v)}</div>
        <p class="progress">${progressHTML(v)}</p>
        <button class="btn" data-a="showQR">Mostrar mi QR</button>
      </div>
      ${matchRow}
      <div class="row"><div><b>Trae a un amigo</b><span>Los dos ganan una visita extra.</span></div><button class="btn sm outline" data-a="share">Compartir</button></div>`;
  }

  const couponState = c => (c.status === 'redeemed' ? 'redeemed' : new Date(c.expires_at) < new Date() ? 'expired' : 'active');

  function couponsTab() {
    const list = S.coupons.map(c => {
      const st = couponState(c);
      const sub = st === 'active' ? `Vence el ${fmtDate(c.expires_at)}` : st === 'redeemed' ? 'Canjeado' : 'Vencido';
      return `<button class="cp ${st}" data-a="openCoupon" data-code="${esc(c.code)}">
        <div class="cp-l">${c.discount}%</div><div class="cp-r"><b>${c.discount}% de descuento</b><span>${sub}</span></div><i aria-hidden="true">›</i></button>`;
    }).join('');
    return `<header class="topbar"><h2 class="display big">Mis cupones</h2></header>
      ${list || `<p class="empty">Aún no tienes cupones. Llega a tu visita 5 y gana 15% de descuento.</p>`}`;
  }

  function matchesTab() {
    const tier = tierFor(S.profile.visits_total);
    const rows = S.matches.map(m => {
      const locked = m.mvp_first && m.opens_at && Date.now() < new Date(m.opens_at).getTime() && tier !== 'MVP';
      const btn = m.reserved
        ? `<button class="btn sm outline-y" data-a="cancelRes" data-id="${esc(m.id)}">Reservada</button>`
        : locked
          ? `<button class="btn sm ghost" disabled>Abre el ${fmtDay(m.opens_at).toLowerCase()}</button>`
          : `<button class="btn sm" data-a="reserve" data-id="${esc(m.id)}">Reservar mesa</button>`;
      return `<div class="row match"><div><b>${esc(m.title)}</b><span>${fmtDay(m.starts_at)} · ${fmtTime(m.starts_at)}</span>${m.mvp_first ? '<em class="tag">Los MVP reservan primero</em>' : ''}</div>${btn}</div>`;
    }).join('');
    return `<header class="topbar col"><h2 class="display big">Próximos partidos</h2><p class="lead sm">Reserva tu mesa y llega con tu lugar asegurado.</p></header>
      ${rows || '<p class="empty">No hay partidos programados por ahora.</p>'}`;
  }

  function levelTab() {
    const p = S.profile, v = p.visits_total, t = tierFor(v);
    const next = v < 10 ? { n: 'Titular', at: 10 } : v < 25 ? { n: 'MVP', at: 25 } : null;
    const pct = v < 10 ? (v / 10) * 100 : v < 25 ? ((v - 10) / 15) * 100 : 100;
    const tiers = [
      ['Rookie', 'Al registrarte', 'Tarjeta digital y cupones de 15% y 20%.'],
      ['Titular', 'Desde 10 visitas', 'Además: regalo de cumpleaños y aviso de partidos antes que nadie.'],
      ['MVP', 'Desde 25 visitas', 'Además: reserva prioritaria en los partidos grandes.']
    ].map(([n, when, desc]) => `<div class="tier${n === t ? ' on' : ''}"><div><h4 class="display">${n}</h4><small>${when}</small></div><p>${desc}${n === t ? ' <em class="tag y">Tu nivel</em>' : ''}</p></div>`).join('');
    return `<small class="mute">Tu nivel</small>
      <div class="lvl-head"><h2 class="display huge">${t}</h2><span class="mute">${v} ${v === 1 ? 'visita' : 'visitas'} en total</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <p class="mute sm">${next ? `Te ${next.at - v === 1 ? 'falta 1 visita' : `faltan ${next.at - v} visitas`} para ser ${next.n}.` : 'Estás en el nivel más alto. ¡Gracias por ser MVP!'}</p>
      <div class="tiers">${tiers}</div>
      <div class="friend"><h3 class="display">Trae a un amigo</h3><p>Cuando use tu código en su primera visita, los dos ganan una visita extra.</p>
        <div class="friend-row"><span class="refcode">${esc(p.referral_code || '—')}</span><button class="btn dark sm" data-a="share">Compartir</button></div></div>
      <button class="link" data-a="logout">Cerrar sesión</button>`;
  }

  function tabHTML() {
    return { card: cardTab, coupons: couponsTab, matches: matchesTab, level: levelTab }[S.tab]();
  }

  function layerHTML() {
    if (!S.layer) return '';
    const p = S.profile;
    if (S.layer.type === 'qr') {
      return `<div class="layer"><button class="back" data-a="close" aria-label="Volver">‹</button>
        <h2 class="display big">Mi código</h2><p class="lead sm">Muéstralo al mesero al llegar o al pagar.</p>
        <div class="qr-box" id="qr"></div>
        <p class="qcode">${esc(p.customer_code)}</p><p class="mute center">${esc(firstName(p.name))} · ${tierFor(p.visits_total)}</p>
        <button class="btn bottom" data-a="close">Listo</button></div>`;
    }
    const c = S.coupons.find(x => x.code === S.layer.code);
    if (!c) return '';
    const st = couponState(c);
    return `<div class="layer"><button class="back" data-a="close" aria-label="Volver">‹</button>
      <h2 class="display big">Mi cupón</h2>
      <div class="ticket ${st}">
        <div class="t-top"><div class="pct">${c.discount}%</div><p>de descuento en tu consumo</p></div>
        <div class="perf"></div>
        <div class="t-bot"><div class="qr-box sm" id="qr"></div><p class="qcode sm">${esc(c.code)}</p>${st !== 'active' ? `<span class="stamp-over">${st === 'redeemed' ? 'CANJEADO' : 'VENCIDO'}</span>` : ''}</div>
      </div>
      <p class="fine center">${st === 'active' ? `Válido hasta el ${fmtDate(c.expires_at)}. Un solo uso.<br>Muéstralo a tu mesero al pedir la cuenta.` : st === 'redeemed' ? 'Este cupón ya se usó.' : 'Este cupón ya venció.'}</p>
      <button class="btn bottom" data-a="close">Listo</button></div>`;
  }

  function tdHTML() {
    if (!S.td) return '';
    return `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true">
      <div class="td-badge">¡TOUCHDOWN!</div>
      <h3 class="display big">Ganaste ${S.td.discount}%</h3>
      <p class="lead sm">Tu cupón ya está listo para tu próxima cuenta.</p>
      <button class="btn" data-a="tdView">Ver mi cupón</button>
      <button class="link" data-a="tdLater">Ahora no</button></div></div>`;
  }

  function mainHTML() {
    const tabs = [['card', 'Tarjeta'], ['coupons', 'Cupones'], ['matches', 'Partidos'], ['level', 'Nivel']];
    return `<section class="screen main"><div class="scroll">${tabHTML()}</div>
      <nav class="tabbar">${tabs.map(([k, l]) => `<button class="tab${S.tab === k ? ' on' : ''}" data-a="tab" data-t="${k}">${icons[k]}<span>${l}</span></button>`).join('')}</nav></section>
      ${layerHTML()}${tdHTML()}`;
  }

  function render() {
    const v = S.view;
    app.innerHTML = v === 'login' ? loginHTML() : v === 'otp' ? otpHTML() : v === 'name' ? nameHTML() : v === 'main' ? mainHTML() : '';
    const q = $('#qr');
    if (q) drawQR(q, S.layer.type === 'qr' ? S.profile.customer_code : S.layer.code);
  }

  const go = v => { S.view = v; render(); };

  /* ---------- flujo de acceso ---------- */
  function startCd(n = 30) {
    clearInterval(S.timer);
    S.countdown = n;
    S.timer = setInterval(() => {
      S.countdown--;
      if (S.countdown <= 0) { clearInterval(S.timer); if (S.view === 'otp') render(); }
      else { const el = $('#cd'); if (el) el.textContent = fmtCd(S.countdown); }
    }, 1000);
  }

  function updateOtp() {
    app.querySelectorAll('#otp i').forEach((el, i) => {
      el.textContent = S.code[i] || '';
      el.className = i === S.code.length ? 'cur' : '';
    });
  }

  async function verify() {
    if (S.busy) return;
    S.busy = true;
    try {
      await API.verifyOtp(digits(S.phone), S.code);
      await loadAll();
      clearInterval(S.timer);
      if (S.profile.name) { checkTouchdown(); go('main'); } else go('name');
    } catch (e) {
      S.code = '';
      updateOtp();
      setErr(friendly(e));
      const o = $('#otp'); if (o) { o.classList.remove('shake'); void o.offsetWidth; o.classList.add('shake'); }
    } finally { S.busy = false; }
  }

  const pressKey = k => { if (S.view !== 'otp' || S.busy || S.code.length >= API.otpLength) return; S.code += k; setErr(''); updateOtp(); if (S.code.length === API.otpLength) verify(); };
  const delKey = () => { if (S.view !== 'otp' || S.busy) return; S.code = S.code.slice(0, -1); updateOtp(); };
  document.addEventListener('keydown', e => {
    if (S.view !== 'otp') return;
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === 'Backspace') delKey();
  });

  /* ---------- acciones ---------- */
  const A = {
    fillPhone: el => { const i = $('#phone'); i.value = fmtPhone(el.dataset.p); S.phone = i.value; setErr(''); },
    async send() {
      const d = digits($('#phone').value);
      if (d.length !== 10) return setErr('Escribe tu número de 10 dígitos.');
      const b = $('#sendBtn'); b.disabled = true; b.textContent = 'Enviando…';
      try {
        await API.sendOtp(d);
        S.phone = fmtPhone(d); S.code = '';
        startCd(30); go('otp');
      } catch (e) { b.disabled = false; b.textContent = 'Enviar código'; setErr(friendly(e)); }
    },
    async resend() {
      try { await API.sendOtp(digits(S.phone)); startCd(30); render(); toast('Código enviado'); } catch (e) { setErr(friendly(e)); }
    },
    changeNumber() { clearInterval(S.timer); S.code = ''; go('login'); },
    key: el => pressKey(el.dataset.k),
    del: () => delKey(),
    async saveName() {
      const n = $('#name').value.trim();
      if (n.length < 2) return setErr('Escribe tu nombre.');
      try { await API.setName(n); await loadAll(); checkTouchdown(); go('main'); } catch (e) { setErr(friendly(e)); }
    },
    tab: el => { S.tab = el.dataset.t; render(); },
    showQR: () => { S.layer = { type: 'qr' }; render(); },
    openCoupon: el => { S.layer = { type: 'coupon', code: el.dataset.code }; render(); },
    close: () => { S.layer = null; checkTouchdown(); render(); },
    tdView: () => { markSeen(S.td.code); S.layer = { type: 'coupon', code: S.td.code }; S.td = null; render(); },
    tdLater: () => { markSeen(S.td.code); S.td = null; render(); },
    async share() {
      const code = S.profile.referral_code;
      const url = location.href.split('?')[0].split('#')[0] + '?ref=' + encodeURIComponent(code);
      const text = `Únete a Strikers con mi código ${code} y los dos ganamos una visita extra.`;
      try {
        if (navigator.share) await navigator.share({ title: 'Strikers', text, url });
        else { await navigator.clipboard.writeText(`${text} ${url}`); toast('Link copiado'); }
      } catch (e) { /* el usuario canceló */ }
    },
    async reserve(el) {
      try { await API.reserve(el.dataset.id); await loadAll(); render(); toast('Mesa reservada'); }
      catch (e) { toast(friendly(e)); }
    },
    async cancelRes(el) {
      if (!confirm('¿Cancelar tu reservación?')) return;
      try { await API.cancelReservation(el.dataset.id); await loadAll(); render(); toast('Reservación cancelada'); }
      catch (e) { toast(friendly(e)); }
    },
    async logout() { await API.signOut(); Object.assign(S, { profile: null, layer: null, td: null, tab: 'card', phone: '', code: '' }); go('login'); }
  };

  app.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a] && !el.disabled) A[el.dataset.a](el);
  });
  app.addEventListener('input', e => {
    if (e.target.id === 'phone') { const d = digits(e.target.value); e.target.value = fmtPhone(d); S.phone = e.target.value; }
  });
  app.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'phone') A.send();
    if (e.key === 'Enter' && e.target.id === 'name') A.saveName();
  });

  /* ---------- arranque ---------- */
  (async function init() {
    try {
      if (await API.session()) {
        await loadAll();
        if (S.profile.name) { checkTouchdown(); return go('main'); }
        return go('name');
      }
    } catch (e) { console.warn(e); }
    go('login');
  })();
})();
