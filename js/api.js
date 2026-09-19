/**
 * Capa de datos. Expone window.API con la misma interfaz en dos modos:
 *  - demo:      todo en localStorage (sin backend)
 *  - supabase:  Auth por teléfono + tablas/RPC definidas en supabase/schema.sql
 */
(function () {
  const C = window.STRIKERS_CONFIG;
  const { tierFor, cardPos } = window.SK;
  const DEMO = !C.SUPABASE_URL || !C.SUPABASE_ANON_KEY;
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const rand4 = () => Math.random().toString(36).slice(2, 6).toUpperCase();

  /* ------------------------------------------------------------------ DEMO */
  const KEY = 'strikers_demo_v1';

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

  const freshDb = () => ({ seq: 481, users: {}, coupons: [], reservations: [], matches: buildMatches(), session: null });
  function db() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY)); } catch { /* vacío */ }
    if (!d) { d = freshDb(); save(d); }
    return d;
  }
  const save = d => localStorage.setItem(KEY, JSON.stringify(d));
  const cur = d => {
    const u = d.users[d.session];
    if (!u) throw new Error('Sesión no válida');
    return u;
  };

  function addVisit(d, u) {
    u.visits_total++;
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
          referral_code: null, visits_total: 0, referred_by: referrer ? referrer.id : null
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
      if (d.matches.some(m => new Date(m.starts_at) < new Date())) { d.matches = buildMatches(); d.reservations = []; save(d); }
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
    async staffSession() { return true; },
    async staffLogin() { },
    async staffSignOut() { },
    async sealVisit(code) {
      await delay(200);
      const d = db();
      const u = Object.values(d.users).find(x => x.customer_code === code.trim().toUpperCase());
      if (!u) throw new Error('No encontramos ese código de cliente');
      const first = u.visits_total === 0;
      const { pos, coupon } = addVisit(d, u);
      let bonus = false;
      if (first && u.referred_by && d.users[u.referred_by]) {
        addVisit(d, d.users[u.referred_by]);
        addVisit(d, u);
        bonus = true;
      }
      save(d);
      return {
        name: u.name, customer_code: u.customer_code, visits_total: u.visits_total,
        position: cardPos(u.visits_total), tier: tierFor(u.visits_total),
        coupon: coupon ? { discount: coupon.discount, code: coupon.code } : null, referral_bonus: bonus, _pos: pos
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
      const u = Object.values(d.users).find(x => x.id === c.customer_id);
      save(d);
      return { code: c.code, discount: c.discount, name: u && u.name };
    },
    async listCustomers() { return Object.values(db().users); },
    async reset() { localStorage.removeItem(KEY); }
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
    async listCustomers() { return []; },
    async reset() { }
  };

  window.API = DEMO ? demo : sup;
})();
