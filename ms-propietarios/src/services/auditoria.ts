import { PoolClient } from "pg";

export type Accion = "CREAR" | "MODIFICAR" | "CANCELAR" | "ELIMINAR";

export async function registrarAuditoria(
  c: PoolClient,
  p: { cuentaId: string; accion: Accion; entidad: string; registroId: string; antes?: unknown; despues?: unknown }
) {
  await c.query(
    `INSERT INTO auditoria_accion (cuenta_id, accion, entidad, registro_id, datos_anteriores, datos_nuevos)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [p.cuentaId, p.accion, p.entidad, p.registroId,
     p.antes ? JSON.stringify(p.antes) : null, p.despues ? JSON.stringify(p.despues) : null]
  );
}
