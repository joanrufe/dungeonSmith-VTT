# Status — SceneSmith-VTT

> Fuente de verdad del estado actual. Actualizar al final de cada sesión.

**Última actualización**: 2026-10-12

---

## Dónde estamos

**Servidor local parado** — el puerto 3001 no está en ejecución (Flask arranca on-demand para campañas). **Turn Tracker commiteado** (PR #9, `9ada3b1` feat: add standalone turn tracker + music folder support). El STATUS anterior lo declaraba "sin commitear" — drift verificado y corregido el 2026-10-12.

---

## Qué funciona hoy

- **Turn Tracker** (en working tree, sin commit):
  - Ruta protegida `/turn-tracker` — página standalone apta para tablet
  - `SceneStore` JSON por escena extendido con `turnTracker`
  - Socket.IO con `role=tracker`
  - Rastreador de iniciativa integrado
  - Nuevos archivos: `public/js/turnTracker.js`, `public/css/turnTracker.css`, `public/turn-tracker.html`
- **VTT base funcional** — escenas, tokens, iniciativa de jugadores y DM, condiciones con múltiples colores, rotación de tokens (Alt)
- **app.py** — backend extendido para servir y persistir el turn tracker
- **Tests** — suite pytest en `tests/`

---

## Próximo paso concreto

- Arrancar el server on-demand y verificar end-to-end el Turn Tracker: ruta protegida, `role=tracker` y persistencia por escena

---

## Deuda técnica conocida

- Backend Express deprecado (server.js, routes.js, socketHandler.js, controllers/, models/) queda en el árbol como código muerto de referencia
- Sin linter, type checker ni formatter; sin cobertura de tests
- `SESSION_SECRET` opcional — si no se setea, las sesiones no sobreviven al reinicio
