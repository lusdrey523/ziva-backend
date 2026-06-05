# ZIVA Identity Platform — Backend MVP

Sistema de identidad financiera criptográfica basado en ECDSA P-256.

---

## Stack

- **Runtime**: Node.js ≥ 18
- **Framework**: Express.js
- **Base de datos**: PostgreSQL
- **Crypto**: Módulo nativo `node:crypto` (sin dependencias externas)

---

## Inicio Rápido

### 1. Clonar e instalar

```bash
git clone <repo>
cd ziva-backend
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
# Editar .env con tus valores
```

Variables requeridas:
```
DATABASE_URL=postgresql://user:password@localhost:5432/ziva_db
NODE_ENV=development
PORT=3000
```

### 3. Crear la base de datos

```bash
createdb ziva_db
npm run db:migrate
```

### 4. Iniciar el servidor

```bash
# Desarrollo (con hot-reload)
npm run dev

# Producción
npm start
```

---

## Despliegue en Railway / Render

1. Crear un servicio PostgreSQL en Railway/Render
2. Copiar `DATABASE_URL` del panel de la base de datos
3. Agregar las variables de entorno del `.env.example`
4. Ejecutar `npm run db:migrate` como comando de build (o en el start script)
5. El servicio detectará el `PORT` automáticamente

**Railway**: En `Settings > Deploy > Start Command`: `npm run db:migrate && npm start`

---

## Arquitectura de Seguridad

```
Cliente                          Servidor ZIVA
  │                                    │
  │── Genera par de llaves ECDSA P-256 │
  │   (clave privada NUNCA sale)       │
  │                                    │
  │── POST /identity/register ────────>│
  │   { zid, publicKey (JWK), sig }    │── Verifica firma ECDSA
  │                                    │── Almacena solo clave PÚBLICA
  │<── 201 Created ───────────────────│
  │                                    │
  │── POST /auth/challenge ───────────>│── Genera 32 bytes aleatorios
  │<── { challenge } ─────────────────│   (TTL: 60 segundos)
  │                                    │
  │   Firma challenge con clave priv.  │
  │── POST /auth/verify ──────────────>│── Verifica firma sobre challenge
  │<── { verified: true } ────────────│── Marca challenge como usado (anti-replay)
  │                                    │
  │── POST /ledger/event ─────────────>│── Verifica firma del evento
  │   { zid, event, sig }              │── Almacena inmutable (append-only)
  │<── 201 Created ───────────────────│── Recalcula reputación async
```

---

## Endpoints y Ejemplos

### Health Check

```http
GET /health
```

**Respuesta:**
```json
{
  "status": "ok",
  "service": "ZIVA Identity Platform",
  "version": "1.0.0",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "environment": "development"
}
```

---

### POST /identity/register

Registra una nueva identidad criptográfica.

**Payload que el cliente debe firmar (Canonical JSON):**
```
{"publicKey":{"crv":"P-256","kty":"EC","x":"...","y":"..."},"zid":"alice2025"}
```

**Request:**
```json
{
  "zid": "alice2025",
  "publicKey": {
    "kty": "EC",
    "crv": "P-256",
    "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
    "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"
  },
  "signature": "MEYCIQDxyz...base64DER==",
  "country_code": "MX"
}
```

**Respuesta 201:**
```json
{
  "success": true,
  "message": "Identidad registrada exitosamente",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "zid": "alice2025",
    "zid_hash": "a1b2c3d4...sha256hex...",
    "country_code": "MX",
    "status": "active",
    "created_at": "2025-01-15T10:00:00.000Z"
  }
}
```

**Errores comunes:**
- `400` — Validación fallida (JWK inválido, firma malformada)
- `401` — Firma ECDSA no válida
- `409` — ZID o clave pública ya registrados
- `429` — Rate limit (máx. 5 registros/hora por IP)

---

### POST /auth/challenge

Solicita un challenge para iniciar autenticación.

**Request:**
```json
{ "zid": "alice2025" }
```

**Respuesta 200:**
```json
{
  "success": true,
  "message": "Challenge generado. Firma el challenge con tu clave privada y envíalo a /auth/verify.",
  "data": {
    "challenge": "a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
    "expires_at": "2025-01-15T10:01:00.000Z",
    "ttl_seconds": 60
  }
}
```

---

### POST /auth/verify

Verifica la firma del challenge.

**El cliente firma el string del challenge (hex, como UTF-8) con su clave privada.**

**Request:**
```json
{
  "zid": "alice2025",
  "challenge": "a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1",
  "signature": "MEQCIHxyz...base64DER=="
}
```

**Respuesta 200:**
```json
{
  "success": true,
  "message": "Autenticación exitosa",
  "data": {
    "verified": true,
    "zid": "alice2025",
    "authenticated_at": "2025-01-15T10:00:45.000Z"
  }
}
```

**Errores comunes:**
- `401` — Challenge no encontrado, expirado, ya usado (replay) o firma inválida
- `429` — Rate limit de autenticación (máx. 10/15min por IP+ZID)

---

### POST /ledger/event

Registra un evento firmado en el ledger inmutable.

**Payload que el cliente firma:**
```
{"event":{"amount":500,"currency":"MXN","type":"payment"},"zid":"alice2025"}
```
*(Canonical JSON: llaves ordenadas alfabéticamente)*

**Request:**
```json
{
  "zid": "alice2025",
  "event": {
    "type": "payment",
    "amount": 500,
    "currency": "MXN",
    "recipient": "bob2025",
    "memo": "Pago mensual"
  },
  "signature": "MEYCIQD...base64DER=="
}
```

**Respuesta 201:**
```json
{
  "success": true,
  "message": "Evento registrado en el ledger",
  "data": {
    "id": "7f3a8b9c-...",
    "sequence_num": 42,
    "zid": "alice2025",
    "event_type": "payment",
    "payload_hash": "d4e5f6a7b8c9...sha256...",
    "prev_event_hash": "a1b2c3d4...sha256...",
    "server_timestamp": "2025-01-15T10:05:00.000Z"
  }
}
```

---

### GET /ledger/:zid

Consulta el historial de eventos.

```http
GET /ledger/alice2025?limit=10&offset=0&event_type=payment
```

**Respuesta 200:**
```json
{
  "success": true,
  "data": {
    "events": [...],
    "total": 42,
    "limit": 10,
    "offset": 0
  }
}
```

---

### GET /reputation/:zid

Obtiene el score de reputación actual (0–100).

```http
GET /reputation/alice2025
```

**Respuesta 200:**
```json
{
  "success": true,
  "data": {
    "zid": "alice2025",
    "score": 73.50,
    "factors": {
      "activity": 80,
      "transaction_history": 65,
      "consistency": 70,
      "trust_signals": 85,
      "account_age": 40,
      "_meta": {
        "total_events": 42,
        "recent_events_30d": 15,
        "unique_event_types": 4,
        "account_age_days": 30,
        "has_country_code": true
      }
    },
    "algorithm_version": 1,
    "calculated_at": "2025-01-15T10:05:01.000Z"
  }
}
```

---

### POST /reputation/:zid/recalculate

Fuerza el recálculo del score.

```http
POST /reputation/alice2025/recalculate
```

---

## Código de Ejemplo — Cliente JavaScript

```javascript
// Generar par de llaves ECDSA P-256 en el browser (Web Crypto API)
const keyPair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

// Exportar clave pública como JWK
const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
// publicKeyJWK.d está undefined (clave pública, no privada) ✓

// Función de JSON canónico
function canonicalJSON(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return JSON.stringify(obj);
  }
  const sorted = Object.keys(obj).sort();
  return '{' + sorted.map(k => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

// Firmar un payload
async function sign(privateKey, payloadString) {
  const data = new TextEncoder().encode(payloadString);
  const sigBuffer = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    data
  );
  return btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
}

// Ejemplo: registrar identidad
const zid = 'alice2025';
const payload = canonicalJSON({
  publicKey: { crv: publicKeyJWK.crv, kty: publicKeyJWK.kty, x: publicKeyJWK.x, y: publicKeyJWK.y },
  zid
});
const signature = await sign(keyPair.privateKey, payload);

await fetch('/identity/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ zid, publicKey: publicKeyJWK, signature, country_code: 'MX' })
});

// Ejemplo: autenticar
const { data: { challenge } } = await fetch('/auth/challenge', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ zid })
}).then(r => r.json());

const challengeSig = await sign(keyPair.privateKey, challenge);
await fetch('/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ zid, challenge, signature: challengeSig })
});
```

---

## Estructura del Proyecto

```
ziva-backend/
├── src/
│   ├── index.js                  # Entry point, configuración Express
│   ├── controllers/
│   │   ├── identityController.js
│   │   ├── authController.js
│   │   ├── ledgerController.js
│   │   └── reputationController.js
│   ├── services/
│   │   ├── identityService.js    # Lógica de registro y validación
│   │   ├── authService.js        # Challenge-response anti-replay
│   │   ├── ledgerService.js      # Ledger inmutable con encadenamiento
│   │   └── reputationService.js  # Scoring determinista 0-100
│   ├── routes/
│   │   ├── identity.js
│   │   ├── auth.js
│   │   ├── ledger.js
│   │   └── reputation.js
│   ├── middlewares/
│   │   ├── validation.js         # Joi schemas + sanitización
│   │   ├── rateLimiter.js        # 4 limiters diferenciados
│   │   ├── security.js           # Helmet + HTTPS enforcement
│   │   └── logger.js             # HTTP logging + error handler
│   ├── db/
│   │   ├── pool.js               # Pool de conexiones PostgreSQL
│   │   └── migrate.js            # Migración completa de tablas
│   └── utils/
│       ├── crypto.js             # ECDSA P-256, canonical JSON, hashing
│       └── logger.js             # Winston con sanitización de datos sensibles
├── .env.example
├── .gitignore
├── package.json
└── README.md
```
