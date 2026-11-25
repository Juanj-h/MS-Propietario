# MS-Propietarios

Node.js + TypeScript + Express + PostgreSQL.

## Puesta en marcha
1. `docker compose up -d`   (PostgreSQL)
2. `npm install`
3. `npm run db:init`        (crea las tablas)
4. `npm run dev`            (o F5 en VS Code)

Pruebas rápidas: abre `requests.http` con la extensión REST Client.
Todas las operaciones de escritura requieren el header `x-cuenta-id` (cuenta de MS-Acceso).
