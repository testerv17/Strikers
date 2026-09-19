/**
 * Configuración de Strikers.
 * MODO DEMO (USE_SUPABASE: false o claves vacías): datos en localStorage, 4 cuentas de ejemplo
 * y código de verificación fijo. Para usar Supabase: pon USE_SUPABASE en true y llena las 2 claves.
 */
window.STRIKERS_CONFIG = {
  USE_SUPABASE: false,     // false = demo con cuentas de ejemplo; true = usar Supabase (requiere las 2 claves)

  SUPABASE_URL: '',        // ej. https://abcdxyz.supabase.co
  SUPABASE_ANON_KEY: '',   // clave "anon public" (Project Settings → API)

  COUNTRY_CODE: '+52',     // lada de país que se antepone al teléfono
  OTP_CHANNEL: 'sms',      // 'sms' | 'whatsapp' (WhatsApp requiere Twilio en Supabase)
  OTP_LENGTH: 6,           // largo del código en Supabase (por defecto 6)

  DEMO_OTP: '1234',        // código que acepta el modo demo (cliente)
  DEMO_STAFF_PIN: '1234'   // PIN del mesero en modo demo
};
