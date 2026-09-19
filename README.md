# Strikers · Demo web móvil

App de cliente frecuente en HTML + CSS + JavaScript (sin build) con Supabase como backend opcional.

```
index.html          App del cliente (pantallas 1–8 del PDF)
staff.html          Vista del mesero: sellar visitas y canjear cupones
css/styles.css
js/config.js        ← aquí pones las claves de Supabase
js/shared.js        formato de fechas, QR, iconos
js/api.js           capa de datos: modo demo (localStorage) y modo Supabase
js/app.js           lógica y vistas del cliente
js/staff.js         lógica del mesero
supabase/schema.sql tablas, seguridad (RLS) y funciones
```

## 1. Probar ahora (modo demo, sin Supabase)

Con `USE_SUPABASE: false` en `js/config.js` la app guarda todo en el navegador. El código de
verificación es siempre **1234** y hay 4 cuentas de ejemplo (aparecen como botones en el login):

| Cuenta | Teléfono | Estado |
|---|---|---|
| Carlos | 55 1234 5678 | Rookie, 4 visitas: a 1 visita del 15% (el flujo del PDF) |
| Ana | 81 1111 0002 | Rookie, 9 visitas: a 1 visita del 20%, con cupón de 15% activo |
| Diego | 81 1111 0003 | Titular, 14 visitas, con cupón de 20% activo |
| Sofía | 81 1111 0004 | MVP, 27 visitas: puede reservar la Noche de peleas |

Cualquier otro número de 10 dígitos se registra como cliente nuevo (pide el nombre).

```bash
cd strikers
python3 -m http.server 8080      # o: npx serve
```

- Cliente: <http://localhost:8080> (con el modo dispositivo móvil de DevTools)
- Mesero: <http://localhost:8080/staff.html> (mismo navegador): lista los clientes con **+1 visita**

Recorrido sugerido: entra como Carlos → en `staff.html` pulsa **+1 visita** a Carlos → vuelve a la app:
verás el sello animado y el modal **¡Touchdown!** con su cupón de 15%. Después, en `staff.html`,
escribe el código del cupón (STK15-…) para canjearlo. **Reiniciar datos demo** restaura las 4 cuentas.

## 2. Conectar Supabase

1. Crea un proyecto en supabase.com.
2. **SQL Editor** → pega y ejecuta `supabase/schema.sql`.
3. **Authentication → Providers → Phone**: actívalo y configura Twilio (SMS, o WhatsApp con Twilio).
   Para desarrollar sin gastar mensajes, usa *Test phone numbers and OTPs* (número + código fijo).
4. Copia `Project URL` y la clave `anon public` (Project Settings → API) a `js/config.js` y pon `USE_SUPABASE: true`.
   Usa un proyecto de Supabase exclusivo para Strikers (no lo mezcles con otra app: comparten usuarios y tablas).
   Si usas WhatsApp, cambia `OTP_CHANNEL` a `'whatsapp'`.
5. Crea al mesero en **Authentication → Users** (email + contraseña) y ejecuta:
   ```sql
   insert into public.staff (user_id, name)
   select id, 'Mesero 1' from auth.users where email = 'mesero@strikers.mx';
   ```

La clave `anon` es pública por diseño; la seguridad la dan las políticas RLS y las funciones
del esquema (los clientes no pueden escribir visitas, cupones ni niveles directamente).

Para refrescar los partidos de ejemplo: `select public.seed_matches();`

## Reglas de negocio implementadas

- Tarjeta de 10 sellos: cupón de **15% en la visita 5** y de **20% en la 10**; después la tarjeta se reinicia.
- Cupones de un solo uso, vencen a los 30 días, se canjean con QR desde `staff.html`.
- Niveles por visitas totales: Rookie (0), Titular (10), MVP (25).
- Partidos “grandes” (`mvp_first`): antes de `opens_at` solo reservan los MVP.
- Trae a un amigo: `?ref=CODIGO` en el link; en la primera visita del invitado, ambos ganan una visita extra.
- Anti-duplicados: en `seal_visit` cambia `v_cooldown` a `'4 hours'` para producción.

## Notas

- El escaneo con cámara del mesero usa `BarcodeDetector` (Chrome/Android) y necesita HTTPS o localhost;
  en otros navegadores se escribe el código a mano.
- El código OTP de Supabase es de 6 dígitos por defecto; `OTP_LENGTH` controla las casillas.
- Fuentes (Google Fonts), `qrcode-generator` y `supabase-js` se cargan por CDN.

## Siguientes pasos naturales

Realtime en lugar de sondeo cada 4 s, PWA instalable (manifest + service worker), notificaciones
de cumpleaños y de partidos, panel de administración de partidos, y capacidad por partido en reservas.
