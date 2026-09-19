/* Utilidades compartidas entre la app del cliente y la del mesero */
(function () {
  const TZ = 'America/Monterrey';
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Nivel según visitas totales
  const tierFor = v => (v >= 25 ? 'MVP' : v >= 10 ? 'Titular' : 'Rookie');
  // Posición dentro de la tarjeta de 10 sellos (0..10). Tras la visita 10 la tarjeta se reinicia.
  const cardPos = v => (v <= 0 ? 0 : ((v - 1) % 10) + 1);

  const fmtDay = iso => cap(new Intl.DateTimeFormat('es-MX', { weekday: 'long', timeZone: TZ }).format(new Date(iso)));
  const fmtTime = iso =>
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ })
      .format(new Date(iso))
      .replace(/\s?(AM|PM)/i, (m, a) => ' ' + a.toLowerCase());
  const fmtDate = iso => new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(iso));

  const svg = (inner, s = 22) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const icons = {
    card: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18"/>'),
    coupons: svg('<path d="M3 9V7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a3 3 0 0 0 0 6v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a3 3 0 0 0 0-6z"/><path d="M14 6v12" stroke-dasharray="2 3"/>'),
    matches: svg('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    level: svg('<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/>')
  };

  const football = (s = 28) =>
    `<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><g transform="rotate(-35 12 12)"><ellipse cx="12" cy="12" rx="10.5" ry="6.4" fill="#1a1400"/><path d="M7.5 12h9M9.6 10.2v3.6M12 10.2v3.6M14.4 10.2v3.6" stroke="#FFC20E" stroke-width="1.2" stroke-linecap="round"/></g></svg>`;

  // Dibuja un QR como SVG dentro de `el` (usa la librería qrcode-generator)
  function drawQR(el, text) {
    if (!el) return;
    if (typeof window.qrcode !== 'function') { el.textContent = text; return; }
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    el.innerHTML = `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="Código QR ${esc(text)}"><path d="${d}" fill="#000"/></svg>`;
  }

  window.SK = { TZ, esc, tierFor, cardPos, fmtDay, fmtTime, fmtDate, icons, football, drawQR };
})();
