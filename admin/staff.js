/* Strikers · Vista del mesero: escanear, confirmar, sellar visitas y canjear cupones */
(function () {
  const { esc, tierFor, cardPos, fmtTime, fmtDate } = window.SK;
  const C = window.STRIKERS_CONFIG;
  const root = document.getElementById('staff');
  const sheetRoot = document.getElementById('sheetRoot');
  const $ = s => root.querySelector(s);

  const T = { tab: 'scan', pin: '', busy: false, sheet: null, stream: null, raf: 0, activity: null, loginErr: '' };
  const STAFF_PIN = String(C.DEMO_STAFF_PIN || '1234');
  const PIN_LEN = STAFF_PIN.length;
  const initials = n => (n || '?').trim().charAt(0).toUpperCase();
  const first = n => (n || 'Cliente').trim().split(/\s+/)[0];

  /* ------------------------------------------------------------ acceso */
  function head(extra = '') {
    return `<header class="s-head"><h1 class="logo">STRIKERS</h1><span class="pill">Mesero</span>${extra}</header>`;
  }

  function pinView() {
    const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<button data-a="key" data-k="${k}">${k}</button>`).join('');
    root.innerHTML = `${head()}
      <h2 class="display big">Ingresa tu PIN</h2>
      <p class="lead sm">Acceso del personal.</p>
      <div class="otp" id="pinbox">${Array.from({ length: PIN_LEN }, (_, i) => `<i class="${i === 0 ? 'cur' : ''}"></i>`).join('')}</div>
      <p class="err" id="err" role="alert"></p>
      <p class="demo-tag static">Modo demo · PIN: ${esc(STAFF_PIN)} · <a href="index.html">App del cliente</a></p>
      <div class="pad">${keys}<button class="z" data-a="key" data-k="0">0</button><button data-a="del" aria-label="Borrar">⌫</button></div>`;
  }
  function updatePin() {
    root.querySelectorAll('#pinbox i').forEach((el, i) => { el.textContent = T.pin[i] ? '•' : ''; el.className = i === T.pin.length ? 'cur' : ''; });
  }
  async function pinKey(k) {
    if (T.busy || T.pin.length >= PIN_LEN) return;
    T.pin += k; updatePin(); setErr('');
    if (T.pin.length === PIN_LEN) {
      T.busy = true;
      try { await API.staffLogin(T.pin); T.pin = ''; mainView(); }
      catch (e) {
        T.pin = ''; updatePin(); setErr(e.message || 'PIN incorrecto');
        const o = $('#pinbox'); if (o) { o.classList.remove('shake'); void o.offsetWidth; o.classList.add('shake'); }
      } finally { T.busy = false; }
    }
  }

  function emailView() {
    root.innerHTML = `${head()}
      <h2 class="display big">Entrar</h2>
      <label class="lbl" for="em">Correo</label><input id="em" class="field" type="email" autocomplete="username">
      <label class="lbl" for="pw" style="margin-top:12px">Contraseña</label><input id="pw" class="field" type="password" autocomplete="current-password">
      <p class="err" id="err" role="alert"></p>
      <button class="btn" data-a="login">Entrar</button>`;
  }

  const setErr = m => { const el = $('#err'); if (el) el.textContent = m || ''; };
  const loginView = () => (API.demo ? pinView() : emailView());

  /* -------------------------------------------------------- vista principal */
  function mainView() {
    const seg = `<div class="seg" role="tablist">
      <button class="${T.tab === 'scan' ? 'on' : ''}" data-a="tab" data-t="scan">Escanear</button>
      <button class="${T.tab === 'today' ? 'on' : ''}" data-a="tab" data-t="today">Hoy</button></div>`;
    root.innerHTML = `${head('<button class="link right" data-a="out">Salir</button>')}${seg}${T.tab === 'scan' ? scanHTML() : todayHTML()}`;
    if (T.tab === 'scan' && API.demo) renderCustomers();
  }

  function scanHTML() {
    return `<div class="scanner" id="scanner">
        <video id="cam" playsinline muted></video>
        <div class="frame" aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
        <p class="scan-hint">Apunta al QR del cliente o de su cupón</p>
      </div>
      <button class="btn" id="camBtn" data-a="openCam">Abrir cámara</button>
      <p class="or"><span>o escribe el código</span></p>
      <div class="codebar">
        <input id="code" class="field" placeholder="C-00482 o STK15-7K2M" autocapitalize="characters" autocomplete="off" spellcheck="false">
        <button class="btn sm" data-a="lookup">Buscar</button>
      </div>
      ${API.demo ? '<h3 class="display s-sub">Clientes demo</h3><div id="cust"></div><button class="link" data-a="reset">Reiniciar datos demo</button>' : ''}`;
  }

  async function renderCustomers() {
    const box = $('#cust'); if (!box) return;
    const list = await API.listCustomers();
    box.innerHTML = list.map(u => `<button class="row pick" data-a="pick" data-code="${esc(u.customer_code)}">
      <div><b>${esc(u.name || 'Sin nombre')}</b><span>${esc(u.customer_code)} · ${tierFor(u.visits_total)} · ${u.visits_total} visitas</span></div><i aria-hidden="true">›</i></button>`).join('');
  }

  function todayHTML() {
    const a = T.activity;
    if (!a) return '<p class="empty">Cargando…</p>';
    const rows = a.events.map(e => e.type === 'visit'
      ? `<div class="ev"><span class="ev-i v">✓</span><div><b>${esc(e.name || 'Cliente')}</b><span>Visita sellada${e.customer_code ? ' · ' + esc(e.customer_code) : ''}</span></div><time>${fmtTime(e.at)}</time></div>`
      : `<div class="ev"><span class="ev-i r">%</span><div><b>Cupón ${e.discount}% canjeado</b><span>${esc(e.name || 'Cliente')} · ${esc(e.code)}</span></div><time>${fmtTime(e.at)}</time></div>`).join('');
    return `<div class="counts"><div><b>${a.visits}</b><span>Visitas selladas</span></div><div><b>${a.redeems}</b><span>Cupones canjeados</span></div></div>
      ${rows || '<p class="empty">Todavía no hay movimiento hoy.</p>'}`;
  }
  async function loadToday() {
    try { T.activity = await API.staffActivity(); } catch (e) { T.activity = { visits: 0, redeems: 0, events: [] }; }
    if (T.tab === 'today') mainView();
  }

  /* ------------------------------------------------------- hoja de acción */
  function drawSheet() {
    const s = T.sheet;
    if (!s) { sheetRoot.innerHTML = ''; return; }
    const dis = T.busy ? 'disabled' : '';
    let body = '';

    if (s.kind === 'customer') {
      const r = s.r, next = cardPos(r.visits_total + 1);
      const promo = next === 5 ? 'Con esta visita gana un cupón de <b class="y">15%</b>.' : next === 10 ? 'Con esta visita gana un cupón de <b class="y">20%</b>.' : `Esta sería su visita <b class="y">${next} de 10</b>.`;
      const mins = r.last_visit_at ? Math.round((Date.now() - new Date(r.last_visit_at).getTime()) / 6e4) : null;
      const ago = mins === null ? '' : mins < 1 ? 'hace un momento' : mins < 60 ? `hace ${mins} min` : `hace ${Math.round(mins / 60)} h`;
      const warn = mins !== null && mins < 240 ? `<p class="warn">A este cliente ya se le selló una visita ${ago}.</p>` : '';
      const dots = Array.from({ length: 10 }, (_, i) => `<i class="dot${i < r.position ? ' on' : ''}${i === 4 || i === 9 ? ' key' : ''}"></i>`).join('');
      const cps = r.coupons.map(c => `<button class="btn outline-y" data-a="redeem" data-code="${esc(c.code)}" ${dis}>Canjear cupón ${c.discount}% · ${esc(c.code)}</button>`).join('');
      body = `<div class="who"><div class="avatar">${esc(initials(r.name))}</div><div><h3 class="display">${esc(r.name || 'Cliente')}</h3><span class="mute">${esc(r.customer_code)} · ${esc(r.tier)} · ${r.visits_total} visitas</span></div></div>
        <div class="dots" aria-label="Sellos">${dots}</div>
        <p class="promo">${promo}</p>${warn}
        <button class="btn" data-a="seal" ${dis}>${T.busy ? 'Sellando…' : 'Sellar visita'}</button>${cps}`;
    } else if (s.kind === 'coupon') {
      const r = s.r, ok = r.status === 'active';
      const label = ok ? `Vigente · vence el ${fmtDate(r.expires_at)}` : r.status === 'redeemed' ? 'Ya fue canjeado' : 'Vencido';
      body = `<div class="cpv ${ok ? '' : 'off'}"><div class="cpv-l">${r.discount}%</div><div><h3 class="display">Cupón ${r.discount}%</h3><span class="mute">${esc(r.code)} · ${esc(first(r.name))}</span></div></div>
        <p class="${ok ? 'promo' : 'warn'}">${label}</p>
        ${ok ? `<button class="btn" data-a="redeem" data-code="${esc(r.code)}" ${dis}>${T.busy ? 'Canjeando…' : 'Canjear cupón'}</button>` : ''}`;
    } else if (s.kind === 'done') {
      body = `<div class="ok-ico" aria-hidden="true">✓</div><h3 class="display big center">${esc(s.title)}</h3>
        ${s.lines.map(l => `<p class="center mute">${l}</p>`).join('')}
        ${s.win ? `<div class="win"><b>¡Touchdown!</b><span>Ganó un cupón de ${s.win.discount}% · ${esc(s.win.code)}</span></div>` : ''}
        <button class="btn" data-a="done">Listo</button>`;
    } else {
      body = `<div class="ok-ico bad" aria-hidden="true">!</div><h3 class="display big center">No se pudo</h3><p class="center mute">${esc(s.msg)}</p><button class="btn" data-a="closeSheet">Cerrar</button>`;
    }

    const err = s.err ? `<p class="err center" role="alert">${esc(s.err)}</p>` : '';
    const cancel = s.kind === 'customer' || s.kind === 'coupon' ? '<button class="link center-l" data-a="closeSheet">Cancelar</button>' : '';
    sheetRoot.innerHTML = `<div class="sheet-wrap" data-a="backdrop"><div class="sheet" role="dialog" aria-modal="true">${body}${err}${cancel}</div></div>`;
  }

  async function lookup(raw) {
    const code = String(raw || '').trim();
    if (!code) return;
    stopCam();
    try { const r = await API.staffLookup(code); T.sheet = { kind: r.type, r }; }
    catch (e) { T.sheet = { kind: 'error', msg: e.message || 'Error desconocido' }; }
    drawSheet();
  }

  async function run(fn) {
    if (T.busy) return;
    T.busy = true; if (T.sheet) T.sheet.err = ''; drawSheet();
    try { T.sheet = await fn(); if (navigator.vibrate) navigator.vibrate(60); T.activity = null; }
    catch (e) { T.sheet.err = e.message || 'No se pudo completar'; }
    finally { T.busy = false; drawSheet(); }
  }

  const doSeal = () => run(async () => {
    const r = await API.sealVisit(T.sheet.r.customer_code);
    return {
      kind: 'done', title: 'Visita sellada', win: r.coupon,
      lines: [`${esc(first(r.name))} lleva <b>${r.position} de 10</b> · ${esc(r.tier)}`, r.referral_bonus ? 'Bono de amigo: visita extra para los dos' : ''].filter(Boolean)
    };
  });
  const doRedeem = code => run(async () => {
    const r = await API.redeemCoupon(code);
    return { kind: 'done', title: `Cupón ${r.discount}% canjeado`, lines: [`Aplícalo a la cuenta de ${esc(first(r.name))}`, esc(r.code)] };
  });

  /* ------------------------------------------------------------- cámara */
  async function startCam() {
    if (T.stream) return;
    const native = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    if (!native && typeof window.jsQR !== 'function') return showErr('Tu navegador no puede escanear. Escribe el código a mano.');
    try {
      T.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) { return showErr('No se pudo abrir la cámara. Revisa el permiso y que la página use HTTPS.'); }
    const video = $('#cam'), box = $('#scanner'), btn = $('#camBtn');
    if (!video) return stopCam();
    video.srcObject = T.stream;
    await video.play();
    box.classList.add('live'); btn.textContent = 'Cerrar cámara'; btn.dataset.a = 'stopCam'; btn.classList.add('outline');
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!T.stream) return;
      try {
        let val = null;
        if (video.readyState >= 2) {
          if (native) { const r = await native.detect(video); val = r[0] && r[0].rawValue; }
          else {
            const w = Math.min(video.videoWidth, 640), h = Math.round(w * video.videoHeight / video.videoWidth);
            canvas.width = w; canvas.height = h; ctx.drawImage(video, 0, 0, w, h);
            const q = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h); val = q && q.data;
          }
        }
        if (val) return lookup(val);
      } catch (e) { /* frame no listo */ }
      T.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopCam() {
    cancelAnimationFrame(T.raf);
    if (T.stream) T.stream.getTracks().forEach(t => t.stop());
    T.stream = null;
    const box = $('#scanner'), btn = $('#camBtn');
    if (box) box.classList.remove('live');
    if (btn) { btn.textContent = 'Abrir cámara'; btn.dataset.a = 'openCam'; btn.classList.remove('outline'); }
  }
  const showErr = msg => { T.sheet = { kind: 'error', msg }; drawSheet(); };

  /* ---------------------------------------------------------- acciones */
  const A = {
    key: el => pinKey(el.dataset.k),
    del: () => { T.pin = T.pin.slice(0, -1); updatePin(); },
    async login() {
      try { await API.staffLogin($('#em').value.trim(), $('#pw').value); mainView(); }
      catch (e) { setErr(e.message || 'No se pudo entrar'); }
    },
    async out() { stopCam(); await API.staffSignOut(); T.tab = 'scan'; T.activity = null; loginView(); },
    tab: el => { stopCam(); T.tab = el.dataset.t; mainView(); if (T.tab === 'today') loadToday(); },
    openCam: () => startCam(),
    stopCam: () => stopCam(),
    lookup: () => lookup($('#code').value),
    pick: el => lookup(el.dataset.code),
    seal: () => doSeal(),
    redeem: el => doRedeem(el.dataset.code),
    closeSheet: () => { if (!T.busy) { T.sheet = null; drawSheet(); } },
    backdrop: () => { }, // los toques fuera de la hoja no la cierran para evitar cancelar sin querer
    done: () => { T.sheet = null; drawSheet(); const c = $('#code'); if (c) c.value = ''; if (API.demo) renderCustomers(); if (T.tab === 'today') loadToday(); },
    async reset() { if (confirm('¿Restaurar las cuentas de ejemplo y borrar el movimiento?')) { await API.reset(); mainView(); } }
  };
  function dispatch(e) {
    const el = e.target.closest('[data-a]');
    if (el && el === e.target.closest('[data-a]') && A[el.dataset.a] && !el.disabled) A[el.dataset.a](el);
  }
  root.addEventListener('click', dispatch);
  sheetRoot.addEventListener('click', e => { const el = e.target.closest('[data-a]'); if (el && el.dataset.a !== 'backdrop') dispatch(e); });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'code') lookup(e.target.value); if (e.key === 'Enter' && e.target.id === 'pw') A.login(); });
  document.addEventListener('keydown', e => {
    if (!API.demo || $('#pinbox') === null) return;
    if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') A.del();
  });

  (async function init() {
    try { (await API.staffSession()) ? mainView() : loginView(); } catch (e) { loginView(); }
  })();
})();
