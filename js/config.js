/**
 * Configuración de Strikers.
 * Si SUPABASE_URL o SUPABASE_ANON_KEY están vacíos, la app corre en MODO DEMO
 * (datos guardados en localStorage del navegador, código de verificación fijo).
 */
window.STRIKERS_CONFIG = {
  SUPABASE_URL: "https://qxdnbkflhxwtlgfukfow.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_UY9HQKWdAiSbPKqKrUySOw_BQQ1rH-W",

  COUNTRY_CODE: '+52',     // lada de país que se antepone al teléfono
  OTP_CHANNEL: 'sms',      // 'sms' | 'whatsapp' (WhatsApp requiere Twilio en Supabase)
  OTP_LENGTH: 6,           // largo del código en Supabase (por defecto 6)

  DEMO_OTP: '1234'         // código que acepta el modo demo
};
