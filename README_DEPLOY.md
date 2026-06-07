ZIVA Backend — Despliegue en Railway

Resumen rápido
- App preparada para ser resiliente: espera conexión a PostgreSQL sin ejecutar queries en startup, reconexión con backoff, pool configurable y manejo de shutdown.

Variables de entorno recomendadas (Railway Environment Variables)
- DATABASE_URL: URL completa de Postgres (REQUIRED)
- NODE_ENV: production
- PORT: puerto HTTP (opcional, default 3000)
- DB_SSL: true (o dejar que se detecte desde DATABASE_URL con sslmode=require)
- DB_POOL_MAX: 20 (ajustar según plan)
- DB_CONN_MAX_RETRIES: 15
- DB_CONN_BASE_DELAY_MS: 3000
- DB_CONN_BACKOFF_FACTOR: 1.7
- DB_CONN_JITTER: 0.3
- JWT_SECRET o PRIVATE_KEY: secreto para autenticación
- LOG_LEVEL: info (o debug para diagnosticar)

Railway settings
- Health check: configurar la ruta `/health` como endpoint de readiness.
- No ejecutar migraciones automáticas en el arranque del proceso. Usar el script `npm run db:migrate` manualmente o en un job separado.
- Asegurarse de que `DATABASE_URL` no apunte a `localhost` en producción.

Comportamiento clave
- La app no ejecuta queries durante el proceso de start; en su lugar intenta `pool.connect()` con reintentos exponenciales y jitter.
- En errores de pool se loguea pero no se hace `process.exit`, evitando loops de crash cuando la DB falla después del arranque.
- Las migraciones están disponibles como `npm run db:migrate` y deben ejecutarse por separado.

Pruebas locales rápidas
1. Instalar dependencias:

```bash
npm install
```

2. Levantar Postgres localmente o usar una URL válida, por ejemplo con Docker (opcional):

```bash
docker run --rm -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=ziva -p 5432:5432 postgres:15
```

3. Ejecutar con `DATABASE_URL`:

```bash
DATABASE_URL=postgres://postgres:pass@localhost:5432/ziva npm start
```

Notas finales
- Los cambios en el código aplicados están en el branch `railway/code-change-wKYKtv`.
- Si quieres, puedo abrir un Pull Request desde este branch hacia `main` con la descripción de los cambios y recomendaciones.
