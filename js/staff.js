/* Strikers · Vista del mesero: sellar visitas y canjear cupones */
(function () {
  const { esc, tierFor } = window.SK;
  const root = document.getElementById('staff');
  const $ = s => root.querySelector(s);
  let stream = null;

  function loginView() {
    root.innerHTML = `<header class="s-head"><h1 class="logo">STRIKERS</h1><span class="pill">Mesero</span></header>
      <h2 class="display big">Entrar</h2>
      <label class="lbl" for="em">Correo</label><input id="em" class="field" type="email" autocomplete="username">
      <label class="lbl" for="pw">Contraseña</label><input id="pw" class="field" type="password" autocomplete="current-password">
      <p class="err" id="err" role="alert"></p>
      <button class="btn" id="login">Entrar</button>`;
    $('#login').onclick = async () => {
      try { await API.staffLogin($('#em').value.trim(), $('#pw').value); mainView(); }
      catch (e) { $('#err').textContent = e.message || 'No se pudo entrar'; }
    };
  }

  async function mainView() {
    root.innerHTML = `<header class="s-head"><h1 class="logo">STRIKERS</h1><span class="pill">Mesero</span>
        <button class="link right" id="out">${API.demo ? 'Ir a la app' : 'Salir'}</button></header>
      <label class="lbl" for="code">Código del cliente o del cupón</label>
      <input id="code" class="field" placeholder="C-00482 o STK15-7K2M" autocapitalize="characters" autocomplete="off" spellcheck="false">
      <button class="btn" id="go">Confirmar</button>
      <button class="btn outline" id="scan">Escanear QR con la cámara</button>
      <div class="cam" id="camwrap" hidden><video id="cam" playsinline muted></video><button class="btn sm dark" id="stopcam">Cerrar cámara</button></div>
      <div id="out"></div>
      ${API.demo ? '<h3 class="display s-sub">Clientes demo</h3><div id="cust"></div><button class="link" id="reset">Reiniciar datos demo</button>' : ''}`;

    $('#go').onclick = () => handle($('#code').value);
    $('#code').addEventListener('keydown', e => { if (e.key === 'Enter') handle($('#code').value); });
    $('#scan').onclick = scan;
    $('#stopcam').onclick = stopCam;
    $('#out').setAttribute('aria-live', 'polite');
    root.querySelector('.s-head .link').onclick = async () => {
      if (API.demo) { location.href = 'index.html'; return; }
      await API.staffSignOut(); loginView();
    };
    if (API.demo) { $('#reset').onclick = async () => { if (confirm('¿Borrar todos los datos demo?')) { await API.reset(); mainView(); } }; renderCustomers(); }
  }

  async function renderCustomers() {
    const list = await API.listCustomers();
    const box = $('#cust');
    if (!box) return;
    box.innerHTML = list.length
      ? list.map(u => `<div class="row"><div><b>${esc(u.name || 'Sin nombre')}</b><span>${esc(u.customer_code)} · ${tierFor(u.visits_total)} · ${u.visits_total} visitas</span></div><button class="btn sm" data-code="${esc(u.customer_code)}">+1 visita</button></div>`).join('')
      : '<p class="empty">Aún no hay clientes. Regístrate en la app y vuelve aquí.</p>';
    box.querySelectorAll('button[data-code]').forEach(b => (b.onclick = () => handle(b.dataset.code)));
  }

  function card(kind, title, lines) {
    const el = document.createElement('div');
    el.className = `res ${kind}`;
    el.innerHTML = `<b>${title}</b>${lines.filter(Boolean).map(l => `<span>${l}</span>`).join('')}`;
    const out = $('#out');
    out.prepend(el);
    while (out.children.length > 5) out.lastChild.remove();
  }

  async function handle(raw) {
    const code = String(raw || '').trim().toUpperCase();
    if (!code) return;
    try {
      if (/^C-\d+$/.test(code)) {
        const r = await API.sealVisit(code);
        card('ok', '✓ Visita sellada', [
          `${esc(r.name || 'Cliente')} · ${esc(r.customer_code)}`,
          `Visita ${r.position} de 10 · Nivel ${esc(r.tier)}`,
          r.coupon ? `<strong>Se desbloqueó un cupón de ${r.coupon.discount}%</strong>` : '',
          r.referral_bonus ? 'Bono de amigo: visita extra para los dos' : ''
        ]);
      } else if (/^STK\d+-/.test(code)) {
        if (!confirm(`¿Aplicar el cupón ${code}?`)) return;
        const r = await API.redeemCoupon(code);
        card('ok', `✓ Cupón canjeado: ${r.discount}% de descuento`, [`${esc(r.name || 'Cliente')} · ${esc(r.code)}`, 'Aplícalo a la cuenta']);
      } else {
        throw new Error('Código no reconocido. Debe empezar con C- (cliente) o STK (cupón).');
      }
      $('#code').value = '';
      if (API.demo) renderCustomers();
    } catch (e) {
      card('bad', 'No se pudo completar', [esc(e.message || 'Error desconocido')]);
    }
  }

  /* Escaneo con la cámara (BarcodeDetector: Chrome/Android; requiere HTTPS o localhost) */
  async function scan() {
    if (!('BarcodeDetector' in window)) return card('bad', 'Tu navegador no soporta el escaneo', ['Escribe el código a mano.']);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (e) { return card('bad', 'No se pudo abrir la cámara', ['Revisa el permiso o abre la página con HTTPS.']); }
    const video = $('#cam');
    video.srcObject = stream;
    $('#camwrap').hidden = false;
    await video.play();
    const det = new BarcodeDetector({ formats: ['qr_code'] });
    const tick = async () => {
      if (!stream) return;
      try {
        const r = await det.detect(video);
        if (r[0]) { const v = r[0].rawValue; stopCam(); return handle(v); }
      } catch (e) { /* frame no listo */ }
      requestAnimationFrame(tick);
    };
    tick();
  }
  function stopCam() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
    const w = $('#camwrap'); if (w) w.hidden = true;
  }

  (async function init() {
    try { (await API.staffSession()) ? mainView() : loginView(); } catch (e) { loginView(); }
  })();
})();
