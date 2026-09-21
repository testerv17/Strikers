/**
 * Capa de datos. Expone window.API con la misma interfaz en dos modos:
 *  - demo:      todo en localStorage (sin backend)
 *  - supabase:  Auth por teléfono + tablas/RPC definidas en supabase/schema.sql
 */
(function () {
  const C = window.STRIKERS_CONFIG;
  const { tierFor, cardPos } = window.SK;
  const DEMO = !C.USE_SUPABASE || !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const rand4 = () => Math.random().toString(36).slice(2, 6).toUpperCase();

  /* ------------------------------------------------------------------ DEMO */
  const KEY = 'strikers_demo_v3';
  const SEEN_KEY = 'strikers_seen_coupons';
  const STAFF_KEY = 'strikers_staff_ok';
  const ADMIN_KEY = 'strikers_admin_ok';
  const STAFF_PIN = String(C.DEMO_STAFF_PIN || '1234');
  const ADMIN_PIN = String(C.DEMO_ADMIN_PIN || '0000');

  // Cuentas de ejemplo (login: teléfono + código fijo de config.js)
  const DEMO_SEED = [
    { phone: '5512345678', name: 'Carlos Méndez', visits: 4,  code: 'C-00482', ref: 'CARLOS-STK7' },  // a 1 visita del 15%
    { phone: '8111110002', name: 'Ana Ruiz',      visits: 9,  code: 'C-00131', ref: 'ANA-STK3' },    // a 1 visita del 20%
    { phone: '8111110003', name: 'Diego Torres',  visits: 14, code: 'C-00207', ref: 'DIEGO-STK5' },  // Titular
    { phone: '8111110004', name: 'Sofía Vela',    visits: 27, code: 'C-00058', ref: 'SOFIA-STK9' }   // MVP
  ];

  // Fechas en hora de Monterrey (UTC-6 fijo: México ya no usa horario de verano)
  const MTY = -6;
  function nextDow(dow, h, m, from = new Date()) {
    const clock = new Date(from.getTime() + MTY * 36e5);           // "reloj" de Monterrey
    const d = new Date(Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth(), clock.getUTCDate(), h, m));
    d.setUTCDate(d.getUTCDate() + ((dow - clock.getUTCDay() + 7) % 7));
    let real = new Date(d.getTime() - MTY * 36e5);
    if (real <= from) real = new Date(real.getTime() + 7 * 864e5);
    return real;
  }

  function buildMatches() {
    const now = new Date();
    let fight = nextDow(6, 21, 0);
    let opens = new Date(fight.getTime() - 2 * 864e5 - 21 * 36e5); // jueves 00:00
    if (opens <= now) { fight = new Date(fight.getTime() + 7 * 864e5); opens = new Date(opens.getTime() + 7 * 864e5); }
    return [
      { id: 'm1', title: 'Domingo de NFL', starts_at: nextDow(0, 13, 0).toISOString(), mvp_first: false, opens_at: null },
      { id: 'm2', title: 'Clásico de fútbol', starts_at: nextDow(6, 15, 0).toISOString(), mvp_first: false, opens_at: null },
      { id: 'm3', title: 'Noche de peleas', starts_at: fight.toISOString(), mvp_first: true, opens_at: opens.toISOString() },
      { id: 'm4', title: 'Lunes de NFL', starts_at: nextDow(1, 19, 15).toISOString(), mvp_first: false, opens_at: null }
    ];
  }


  /* ----- Historial de ejemplo para la analítica del dueño (determinista) ----- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const DOW_W = [2.0, 0.7, 0.5, 0.8, 1.1, 1.7, 2.3];                    // dom … sáb (bar deportivo: fin de semana fuerte)
  const HOUR_W = [[12, 1], [13, 2.5], [14, 2.5], [15, 1.6], [16, 1], [17, 1], [18, 1.5], [19, 3], [20, 3.6], [21, 3], [22, 2], [23, 0.8]];
  function wpick(rnd, entries) {
    let r = rnd() * entries.reduce((s, e) => s + e[1], 0);
    for (const [v, w] of entries) { r -= w; if (r <= 0) return v; }
    return entries[entries.length - 1][0];
  }
  function pickTime(rnd, t) {
    const cands = [-3, -2, -1, 0, 1, 2, 3].map(o => { const ms = t + o * 864e5; return [ms, DOW_W[new Date(ms + MTY * 36e5).getUTCDay()]]; });
    const c = new Date(wpick(rnd, cands) + MTY * 36e5);                   // reloj de Monterrey
    const hour = wpick(rnd, HOUR_W);
    let ts = Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate(), hour - MTY, Math.floor(rnd() * 60));
    if (ts > Date.now()) ts -= 7 * 864e5;
    return ts;
  }
  function genVisits(rnd, n, lastAgo, gap) {
    const out = []; let t = Date.now() - lastAgo * 864e5;
    for (let i = 0; i < n; i++) { out.push(pickTime(rnd, t)); t -= gap * (0.6 + rnd() * 0.8) * 864e5; }
    return out;
  }
  const NAMES = ['Luis Herrera', 'María Salinas', 'Jorge Treviño', 'Paola Garza', 'Andrés Cantú', 'Valeria Ortiz', 'Ricardo Leal', 'Daniela Reyes', 'Fernando Gil', 'Karla Montes',
    'Omar Villarreal', 'Lucía Benavides', 'Héctor Salazar', 'Mariana Solís', 'Iván Cortés', 'Fátima Rangel', 'Sergio Lozano', 'Renata Ibarra', 'Pablo Elizondo', 'Ximena Coronado',
    'Alan Guerra', 'Jimena Pardo', 'Mauricio Vela', 'Regina Cuéllar', 'Emilio Naranjo', 'Camila Robles', 'Gael Domínguez', 'Andrea Sepúlveda', 'Bruno Escobedo', 'Natalia Zúñiga',
    'Rodrigo Aguilar', 'Sofía Lara', 'Tomás Peña', 'Ingrid Muñoz', 'Julián Escamilla', 'Abril Fuentes', 'Diego Barrera', 'Constanza Rivas', 'Leonardo Mata', 'Mónica Treviño',
    'Ernesto Cavazos', 'Liliana Marroquín', 'Adrián Quiroga', 'Beatriz Nava', 'Cristian Olvera', 'Yaretzi Balderas', 'Nicolás Arreola', 'Perla Sandoval'];
  // [cantidad, rango de visitas, días desde la última visita, días entre visitas]; la última fila: vinieron una sola vez
  const PERSONAS = [[10, [12, 40], [0, 6], [4, 9]], [10, [4, 14], [3, 20], [12, 28]], [8, [3, 12], [25, 44], [10, 25]], [6, [2, 10], [50, 110], [8, 20]], [6, [1, 2], [0, 13], [6, 10]], [8, [1, 1], [18, 95], [10, 10]]];

  function buildHistory(d) {
    const rnd = mulberry32(20260919), now = Date.now();
    const iso = ms => new Date(ms).toISOString();
    d.visits = []; d.extra = {};
    const push = (id, times) => times.forEach(ms => d.visits.push({ customer_id: id, created_at: iso(ms), source: 'staff' }));

    const plan = { '5512345678': [6, 9], '8111110002': [2, 7], '8111110003': [12, 10], '8111110004': [1, 4] };
    DEMO_SEED.forEach(s => {
      const times = genVisits(rnd, s.visits, plan[s.phone][0], plan[s.phone][1]);
      push(s.phone, times);
      d.users[s.phone].created_at = iso(Math.min(...times));
    });

    let i = 0;
    PERSONAS.forEach(([count, vr, lr, gr]) => {
      for (let k = 0; k < count; k++, i++) {
        const n = Math.round(vr[0] + rnd() * (vr[1] - vr[0]));
        const times = genVisits(rnd, n, lr[0] + rnd() * (lr[1] - lr[0]), gr[0] + rnd() * (gr[1] - gr[0]))
          .filter(ms => ms > now - 210 * 864e5).sort((p, q) => p - q);
        if (!times.length) continue;
        const id = 'x' + String(i + 1).padStart(2, '0');
        d.extra[id] = {
          id, name: NAMES[i % NAMES.length], phone: '815550' + String(1000 + i), customer_code: 'C-' + String(300 + i).padStart(5, '0'),
          visits_total: times.length, created_at: iso(times[0]), referral_code: null
        };
        push(id, times);
        times.forEach((ms, idx) => {
          const pos = cardPos(idx + 1), disc = pos === 5 ? 15 : pos === 10 ? 20 : null;
          if (!disc) return;
          const cp = { code: `STK${disc}-${rnd().toString(36).slice(2, 6).toUpperCase()}`, customer_id: id, discount: disc, status: 'active', expires_at: iso(ms + 30 * 864e5), created_at: iso(ms) };
          if (rnd() < 0.62) { cp.status = 'redeemed'; cp.redeemed_at = iso(Math.min(now - 36e5, ms + (1 + rnd() * 15) * 864e5)); }
          d.coupons.push(cp);
        });
      }
    });
    d.visits.sort((p, q) => p.created_at.localeCompare(q.created_at));
  }

  function seedReservations(d) {
    d.reservations = [];
    d.matches.forEach(m => Object.keys(d.extra || {}).forEach(id => {
      if (Math.random() < (m.mvp_first ? 0.15 : 0.3)) d.reservations.push({ match_id: m.id, customer_id: id, created_at: new Date().toISOString() });
    }));
  }

  function freshDb() {
    const d = { seq: 500, users: {}, coupons: [], reservations: [], matches: buildMatches(), session: null, log: [] };
    DEMO_SEED.forEach(s => {
      d.users[s.phone] = { id: s.phone, phone: s.phone, name: s.name, customer_code: s.code, referral_code: s.ref, visits_total: s.visits, referred_by: null };
    });
    const iso = days => new Date(Date.now() + days * 864e5).toISOString();
    const cp = (who, code, discount, status, expIn, ageDays) =>
      ({ code, customer_id: who, discount, status, expires_at: iso(expIn), created_at: iso(-ageDays), redeemed_at: status === 'redeemed' ? iso(-ageDays + 3) : null });
    d.coupons.push(
      cp('8111110002', 'STK15-A9F2', 15, 'active', 22, 8),
      cp('8111110003', 'STK15-D4K1', 15, 'redeemed', -5, 40),
      cp('8111110003', 'STK20-D7M3', 20, 'active', 14, 16),
      cp('8111110004', 'STK15-S2P8', 15, 'redeemed', -30, 90),
      cp('8111110004', 'STK20-S5T1', 20, 'redeemed', -10, 60),
      cp('8111110004', 'STK15-S8W6', 15, 'active', 25, 5)
    );
    buildHistory(d);
    seedReservations(d);
    // Los cupones de ejemplo no disparan el modal ¡Touchdown! al entrar
    localStorage.setItem(SEEN_KEY, JSON.stringify(d.coupons.map(c => c.code)));
    return d;
  }
  function db() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch { /* vacío */ }
    if (!d) { d = freshDb(); save(d); }
    if (!d.log) d.log = [];
    if (!d.visits) d.visits = [];
    if (!d.extra) d.extra = {};
    return d;
  }
  const save = d => localStorage.setItem(KEY, JSON.stringify(d));
  const cur = d => {
    const u = d.users[d.session];
    if (!u) throw new Error('Sesión no válida');
    return u;
  };

  function addVisit(d, u, source = 'staff') {
    u.visits_total++;
    d.visits.push({ customer_id: u.id, created_at: new Date().toISOString(), source });
    const pos = cardPos(u.visits_total);
    const disc = pos === 5 ? 15 : pos === 10 ? 20 : null;
    let coupon = null;
    if (disc) {
      coupon = {
        code: `STK${disc}-${rand4()}`, customer_id: u.id, discount: disc, status: 'active',
        expires_at: new Date(Date.now() + 30 * 864e5).toISOString(), created_at: new Date().toISOString()
      };
      d.coupons.push(coupon);
    }
    return { pos, coupon };
  }

  function makeReferralCode(d, name) {
    const base = (name.trim().split(/\s+/)[0] || 'AMIGO').replace(/[^\p{L}]/gu, '').toUpperCase() || 'AMIGO';
    let code, i = 0;
    do { code = `${base}-STK${Math.floor(Math.random() * 10 ** (1 + Math.floor(i++ / 6)))}`; }
    while (Object.values(d.users).some(u => u.referral_code === code) && i < 40);
    return code;
  }

  const demo = {
    demo: true,
    otpLength: C.DEMO_OTP.length,

    async sendOtp() { await delay(350); },
    async verifyOtp(phone, code) {
      await delay(350);
      if (code !== C.DEMO_OTP) throw new Error('Código incorrecto');
      const d = db();
      d.session = phone;
      if (!d.users[phone]) {
        d.seq++;
        const ref = localStorage.getItem('strikers_ref');
        const referrer = ref && Object.values(d.users).find(u => u.referral_code === ref);
        d.users[phone] = {
          id: phone, phone, name: null, customer_code: 'C-' + String(d.seq).padStart(5, '0'),
          referral_code: null, visits_total: 0, referred_by: referrer ? referrer.id : null, created_at: new Date().toISOString()
        };
      }
      save(d);
    },
    async session() { const d = db(); return !!(d.session && d.users[d.session]); },
    async signOut() { const d = db(); d.session = null; save(d); },

    async getProfile() { return { ...cur(db()) }; },
    async setName(name) {
      const d = db(); const u = cur(d);
      u.name = name.trim();
      if (!u.referral_code) u.referral_code = makeReferralCode(d, u.name);
      save(d);
    },
    async getCoupons() {
      const d = db(); const u = cur(d);
      return d.coupons.filter(c => c.customer_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async getMatches() {
      const d = db(); const u = cur(d);
      const upcoming = d.matches.filter(m => new Date(m.starts_at) >= new Date());
      if (upcoming.length !== d.matches.length) {
        d.matches = upcoming.length ? upcoming : buildMatches();
        d.reservations = d.reservations.filter(r => d.matches.some(m => m.id === r.match_id));
        if (!upcoming.length) seedReservations(d);
        save(d);
      }
      return d.matches
        .map(m => ({ ...m, reserved: d.reservations.some(r => r.match_id === m.id && r.customer_id === u.id) }))
        .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
    },
    async reserve(id) {
      const d = db(); const u = cur(d);
      const m = d.matches.find(x => x.id === id);
      if (!m) throw new Error('Partido no encontrado');
      if (m.mvp_first && m.opens_at && new Date() < new Date(m.opens_at) && tierFor(u.visits_total) !== 'MVP')
        throw new Error('Este partido abre primero para los MVP');
      if (!d.reservations.some(r => r.match_id === id && r.customer_id === u.id)) d.reservations.push({ match_id: id, customer_id: u.id });
      save(d);
    },
    async cancelReservation(id) {
      const d = db(); const u = cur(d);
      d.reservations = d.reservations.filter(r => !(r.match_id === id && r.customer_id === u.id));
      save(d);
    },

    /* --- Mesero --- */
    async staffLogin(pin) {
      await delay(250);
      if (pin !== STAFF_PIN) throw new Error('PIN incorrecto');
      sessionStorage.setItem(STAFF_KEY, '1');
    },
    async staffSession() { return sessionStorage.getItem(STAFF_KEY) === '1'; },
    async staffSignOut() { sessionStorage.removeItem(STAFF_KEY); },

    // Busca un cliente (C-…) o un cupón (STK…) sin modificar nada
    async staffLookup(raw) {
      const code = String(raw).trim().toUpperCase();
      const d = db();
      if (/^C-\d+$/.test(code)) {
        const u = Object.values(d.users).find(x => x.customer_code === code);
        if (!u) throw new Error('No encontramos ese código de cliente');
        return {
          type: 'customer', name: u.name, customer_code: u.customer_code, visits_total: u.visits_total,
          position: cardPos(u.visits_total), tier: tierFor(u.visits_total), last_visit_at: u.last_visit_at || null,
          coupons: d.coupons.filter(c => c.customer_id === u.id && c.status === 'active' && new Date(c.expires_at) > new Date())
            .map(c => ({ code: c.code, discount: c.discount, expires_at: c.expires_at }))
        };
      }
      if (/^STK\d+-/.test(code)) {
        const c = d.coupons.find(x => x.code === code);
        if (!c) throw new Error('Cupón no encontrado');
        const u = Object.values(d.users).find(x => x.id === c.customer_id);
        const status = c.status === 'active' && new Date(c.expires_at) < new Date() ? 'expired' : c.status;
        return { type: 'coupon', code: c.code, discount: c.discount, status, expires_at: c.expires_at, name: u && u.name };
      }
      throw new Error('Código no reconocido. Debe empezar con C- (cliente) o STK (cupón).');
    },
    async sealVisit(code) {
      await delay(200);
      const d = db();
      const u = Object.values(d.users).find(x => x.customer_code === code.trim().toUpperCase());
      if (!u) throw new Error('No encontramos ese código de cliente');
      const first = u.visits_total === 0;
      const { coupon } = addVisit(d, u);
      u.last_visit_at = new Date().toISOString();
      let bonus = false;
      if (first && u.referred_by && d.users[u.referred_by]) {
        addVisit(d, d.users[u.referred_by], 'referral');
        addVisit(d, u, 'referral');
        bonus = true;
      }
      d.log.push({ type: 'visit', at: u.last_visit_at, name: u.name, customer_code: u.customer_code });
      save(d);
      return {
        name: u.name, customer_code: u.customer_code, visits_total: u.visits_total,
        position: cardPos(u.visits_total), tier: tierFor(u.visits_total),
        coupon: coupon ? { discount: coupon.discount, code: coupon.code } : null, referral_bonus: bonus
      };
    },
    async redeemCoupon(code) {
      await delay(200);
      const d = db();
      const c = d.coupons.find(x => x.code === code.trim().toUpperCase());
      if (!c) throw new Error('Cupón no encontrado');
      if (c.status !== 'active') throw new Error('Este cupón ya fue canjeado');
      if (new Date(c.expires_at) < new Date()) throw new Error('Este cupón está vencido');
      c.status = 'redeemed';
      c.redeemed_at = new Date().toISOString();
      const u = Object.values(d.users).find(x => x.id === c.customer_id);
      d.log.push({ type: 'redeem', at: new Date().toISOString(), name: u && u.name, code: c.code, discount: c.discount });
      save(d);
      return { code: c.code, discount: c.discount, name: u && u.name };
    },
    async staffActivity() {
      const d = db();
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const events = d.log.filter(e => new Date(e.at) >= start).sort((a, b) => b.at.localeCompare(a.at));
      return { visits: events.filter(e => e.type === 'visit').length, redeems: events.filter(e => e.type === 'redeem').length, events };
    },

    /* --- Dueño --- */
    async adminLogin(pin) {
      await delay(250);
      if (pin !== ADMIN_PIN) throw new Error('PIN incorrecto');
      sessionStorage.setItem(ADMIN_KEY, '1');
    },
    async adminSession() { return sessionStorage.getItem(ADMIN_KEY) === '1'; },
    async adminSignOut() { sessionStorage.removeItem(ADMIN_KEY); },
    async ownerData() {
      const d = db();
      const customers = [...Object.values(d.users), ...Object.values(d.extra)].map(u => ({
        id: u.id, name: u.name, phone: u.phone, customer_code: u.customer_code, visits_total: u.visits_total, created_at: u.created_at || null
      }));
      return { customers, visits: d.visits, coupons: d.coupons, matches: d.matches, reservations: d.reservations };
    },
    async ownerSaveMatch(m) {
      const d = db();
      d.matches.push({ id: 'm' + Date.now(), title: m.title, starts_at: m.starts_at, mvp_first: !!m.mvp_first, opens_at: m.opens_at || null });
      save(d);
    },
    async ownerDeleteMatch(id) {
      const d = db();
      d.matches = d.matches.filter(x => x.id !== id);
      d.reservations = d.reservations.filter(r => r.match_id !== id);
      save(d);
    },
    async listCustomers() { return Object.values(db().users); },
    demoAccounts() { return DEMO_SEED.map(s => ({ phone: s.phone, name: s.name, visits: s.visits })); },
    async reset() { localStorage.removeItem(KEY); localStorage.removeItem(SEEN_KEY); }
  };

  /* -------------------------------------------------------------- SUPABASE */
  let sb = null;
  let ensured = false;
  const client = () => {
    if (!sb) sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
    return sb;
  };
  const full = p => C.COUNTRY_CODE + p;
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  const uid = async () => (await client().auth.getSession()).data.session.user.id;

  const sup = {
    demo: false,
    otpLength: C.OTP_LENGTH,

    async sendOtp(phone) {
      ok(await client().auth.signInWithOtp({ phone: full(phone), options: { channel: C.OTP_CHANNEL } }));
    },
    async verifyOtp(phone, code) {
      ok(await client().auth.verifyOtp({ phone: full(phone), token: code, type: 'sms' }));
      ensured = false;
    },
    async session() { return !!(await client().auth.getSession()).data.session; },
    async signOut() { ensured = false; await client().auth.signOut(); },

    async getProfile() {
      if (!ensured) {
        const data = ok(await client().rpc('ensure_profile', { p_ref: localStorage.getItem('strikers_ref') }));
        ensured = true;
        return data;
      }
      return ok(await client().from('profiles').select('*').eq('id', await uid()).single());
    },
    async setName(name) { ok(await client().rpc('set_name', { p_name: name })); },
    async getCoupons() {
      return ok(await client().from('coupons').select('code,discount,status,expires_at,created_at').order('created_at', { ascending: false }));
    },
    async getMatches() {
      const [m, r] = await Promise.all([
        client().from('matches').select('*').gte('starts_at', new Date().toISOString()).order('starts_at'),
        client().from('reservations').select('match_id')
      ]);
      const reserved = new Set(ok(r).map(x => x.match_id));
      return ok(m).map(x => ({ ...x, reserved: reserved.has(x.id) }));
    },
    async reserve(id) { ok(await client().rpc('reserve_match', { p_match: id })); },
    async cancelReservation(id) { ok(await client().from('reservations').delete().eq('match_id', id)); },

    /* --- Mesero (email + contraseña; debe existir en la tabla staff) --- */
    async staffLogin(email, password) {
      ok(await client().auth.signInWithPassword({ email, password }));
      if (!(await this.staffSession())) { await client().auth.signOut(); throw new Error('Esta cuenta no tiene permisos de mesero'); }
    },
    async staffSession() {
      const { data } = await client().auth.getSession();
      if (!data.session) return false;
      const r = await client().from('staff').select('user_id').eq('user_id', data.session.user.id).maybeSingle();
      return !!r.data;
    },
    async staffSignOut() { await client().auth.signOut(); },
    async sealVisit(code) { return ok(await client().rpc('seal_visit', { p_code: code })); },
    async redeemCoupon(code) { return ok(await client().rpc('redeem_coupon', { p_code: code })); },

    async staffLookup(raw) {
      const code = String(raw).trim().toUpperCase();
      const c = client();
      if (/^C-\d+$/.test(code)) {
        const p = ok(await c.from('profiles').select('*').eq('customer_code', code).maybeSingle());
        if (!p) throw new Error('No encontramos ese código de cliente');
        const [cp, lv] = await Promise.all([
          c.from('coupons').select('code,discount,expires_at').eq('customer_id', p.id).eq('status', 'active')
            .gte('expires_at', new Date().toISOString()).order('created_at'),
          c.from('visits').select('created_at').eq('customer_id', p.id).eq('source', 'staff')
            .order('created_at', { ascending: false }).limit(1)
        ]);
        return {
          type: 'customer', name: p.name, customer_code: p.customer_code, visits_total: p.visits_total,
          position: cardPos(p.visits_total), tier: tierFor(p.visits_total),
          last_visit_at: (ok(lv)[0] || {}).created_at || null, coupons: ok(cp)
        };
      }
      if (/^STK\d+-/.test(code)) {
        const cp = ok(await c.from('coupons').select('code,discount,status,expires_at,customer_id').eq('code', code).maybeSingle());
        if (!cp) throw new Error('Cupón no encontrado');
        const p = ok(await c.from('profiles').select('name').eq('id', cp.customer_id).maybeSingle());
        const status = cp.status === 'active' && new Date(cp.expires_at) < new Date() ? 'expired' : cp.status;
        return { type: 'coupon', code: cp.code, discount: cp.discount, status, expires_at: cp.expires_at, name: p && p.name };
      }
      throw new Error('Código no reconocido. Debe empezar con C- (cliente) o STK (cupón).');
    },
    async staffActivity() {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const iso = start.toISOString();
      const c = client();
      const [v, r] = await Promise.all([
        c.from('visits').select('created_at,profiles(name,customer_code)').eq('source', 'staff').gte('created_at', iso).order('created_at', { ascending: false }).limit(60),
        c.from('coupons').select('code,discount,redeemed_at,profiles(name)').eq('status', 'redeemed').gte('redeemed_at', iso).order('redeemed_at', { ascending: false }).limit(60)
      ]);
      const visits = ok(v).map(x => ({ type: 'visit', at: x.created_at, name: x.profiles && x.profiles.name, customer_code: x.profiles && x.profiles.customer_code }));
      const redeems = ok(r).map(x => ({ type: 'redeem', at: x.redeemed_at, name: x.profiles && x.profiles.name, code: x.code, discount: x.discount }));
      const events = [...visits, ...redeems].sort((p, q) => q.at.localeCompare(p.at));
      return { visits: visits.length, redeems: redeems.length, events };
    },

    /* --- Dueño (correo + contraseña; debe existir en la tabla admins, ver supabase/admin.sql) --- */
    async adminLogin(email, password) {
      ok(await client().auth.signInWithPassword({ email, password }));
      if (!(await this.adminSession())) { await client().auth.signOut(); throw new Error('Esta cuenta no tiene permisos de dueño'); }
    },
    async adminSession() {
      const { data } = await client().auth.getSession();
      if (!data.session) return false;
      const r = await client().from('admins').select('user_id').eq('user_id', data.session.user.id).maybeSingle();
      return !!r.data;
    },
    async adminSignOut() { await client().auth.signOut(); },
    async ownerData() {
      const c = client();
      const pageAll = async build => {
        const out = [];
        for (let from = 0; from < 50000; from += 1000) {
          const { data, error } = await build().range(from, from + 999);
          if (error) throw error;
          out.push(...data);
          if (data.length < 1000) break;
        }
        return out;
      };
      const since = new Date(Date.now() - 400 * 864e5).toISOString();
      const [customers, visits, coupons, matches, reservations] = await Promise.all([
        pageAll(() => c.from('profiles').select('id,name,phone,customer_code,visits_total,created_at').order('id')),
        pageAll(() => c.from('visits').select('id,customer_id,created_at,source').gte('created_at', since).order('id')),
        pageAll(() => c.from('coupons').select('id,code,customer_id,discount,status,expires_at,redeemed_at,created_at').order('id')),
        pageAll(() => c.from('matches').select('*').order('id')),
        pageAll(() => c.from('reservations').select('id,match_id,customer_id,created_at').order('id'))
      ]);
      return { customers, visits, coupons, matches, reservations };
    },
    async ownerSaveMatch(m) {
      ok(await client().from('matches').insert({ title: m.title, starts_at: m.starts_at, mvp_first: !!m.mvp_first, opens_at: m.opens_at || null }));
    },
    async ownerDeleteMatch(id) { ok(await client().from('matches').delete().eq('id', id)); },
    async listCustomers() { return []; },
    demoAccounts() { return []; },
    async reset() { }
  };

  window.API = DEMO ? demo : sup;
})();
