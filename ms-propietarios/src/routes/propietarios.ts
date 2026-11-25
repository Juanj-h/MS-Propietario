import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { pool, withTx } from "../config/db";
import { asyncH, HttpError } from "../middleware/errors";
import { registrarAuditoria } from "../services/auditoria";

const r = Router();
const id = z.string().uuid();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => cb(null, ["image/jpeg", "image/png"].includes(f.mimetype)),
});

const crear = z.object({
  tipoDocumento: z.string().min(1),
  numeroDocumento: z.string().min(1),
  nombres: z.string().min(1),
  apellidos: z.string().min(1),
  email: z.string().email(),
  telefono: z.string().optional(),
  unidadIds: z.array(z.string().uuid()).optional(),
});
const actualizar = crear.omit({ unidadIds: true }).partial();

// ---------- Imagen facial: helpers ----------
async function revocarYEliminarImagen(c: any, pid: string, cuentaId: string, exigirAutorizacion: boolean) {
  const aut = (await c.query(
    `UPDATE autorizacion_imagen SET revocada_at=now() WHERE propietario_id=$1 AND revocada_at IS NULL RETURNING *`, [pid])).rows[0];
  if (!aut && exigirAutorizacion) throw new HttpError(404, "No hay autorización vigente");
  if (aut) {
    await registrarAuditoria(c, { cuentaId, accion: "ELIMINAR", entidad: "AUTORIZACION_IMAGEN", registroId: aut.id, antes: aut });
  }
  const img = (await c.query(
    `DELETE FROM imagen_facial_propietario WHERE propietario_id=$1 RETURNING id, mime_type, created_at, updated_at`, [pid])).rows[0];
  if (img) {
    await registrarAuditoria(c, { cuentaId, accion: "ELIMINAR", entidad: "IMAGEN_FACIAL_PROPIETARIO", registroId: img.id, antes: { ...img, propietarioId: pid, motivo: "Revocatoria de autorización" } });
  }
}

async function autorizacionVigente(pid: string) {
  const { rows } = await pool.query(`SELECT * FROM autorizacion_imagen WHERE propietario_id=$1 AND revocada_at IS NULL`, [pid]);
  return rows[0];
}

// ---------- CRUD propietario ----------
r.post("/", asyncH(async (req, res) => {
  const d = crear.parse(req.body);
  const row = await withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO propietario (tipo_documento, numero_documento, nombres, apellidos, email, telefono)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.tipoDocumento, d.numeroDocumento, d.nombres, d.apellidos, d.email, d.telefono ?? null]);
    for (const uid of d.unidadIds ?? []) {
      await c.query(`INSERT INTO propietario_unidad (propietario_id, unidad_id) VALUES ($1,$2)`, [rows[0].id, uid]);
    }
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "CREAR", entidad: "PROPIETARIO", registroId: rows[0].id, despues: { ...rows[0], unidadIds: d.unidadIds ?? [] } });
    return rows[0];
  });
  res.status(201).json(row);
}));

r.get("/", asyncH(async (req, res) => {
  const estado = req.query.estado as string | undefined;
  const { rows } = await pool.query(
    `SELECT * FROM propietario WHERE ($1::text IS NULL OR estado=$1) ORDER BY apellidos, nombres`, [estado ?? null]);
  res.json(rows);
}));

r.get("/:id", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  const p = (await pool.query(`SELECT * FROM propietario WHERE id=$1`, [pid])).rows[0];
  if (!p) throw new HttpError(404, "Propietario no encontrado");
  const u = await pool.query(
    `SELECT u.* FROM unidad_residencial u JOIN propietario_unidad pu ON pu.unidad_id=u.id WHERE pu.propietario_id=$1`, [pid]);
  res.json({ ...p, unidades: u.rows });
}));

r.put("/:id", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  const d = actualizar.parse(req.body);
  const row = await withTx(async (c) => {
    const prev = (await c.query(`SELECT * FROM propietario WHERE id=$1 FOR UPDATE`, [pid])).rows[0];
    if (!prev) throw new HttpError(404, "Propietario no encontrado");
    if (prev.estado === "CANCELADO") throw new HttpError(409, "El propietario está cancelado");
    const { rows } = await c.query(
      `UPDATE propietario SET tipo_documento=$2, numero_documento=$3, nombres=$4, apellidos=$5, email=$6, telefono=$7, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [pid, d.tipoDocumento ?? prev.tipo_documento, d.numeroDocumento ?? prev.numero_documento,
       d.nombres ?? prev.nombres, d.apellidos ?? prev.apellidos, d.email ?? prev.email, d.telefono ?? prev.telefono]);
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "MODIFICAR", entidad: "PROPIETARIO", registroId: pid, antes: prev, despues: rows[0] });
    return rows[0];
  });
  res.json(row);
}));

// Cancelación lógica (también revoca autorización y elimina imagen facial)
r.delete("/:id", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  const row = await withTx(async (c) => {
    const prev = (await c.query(`SELECT * FROM propietario WHERE id=$1 FOR UPDATE`, [pid])).rows[0];
    if (!prev) throw new HttpError(404, "Propietario no encontrado");
    if (prev.estado === "CANCELADO") throw new HttpError(409, "El propietario ya está cancelado");
    const { rows } = await c.query(`UPDATE propietario SET estado='CANCELADO', updated_at=now() WHERE id=$1 RETURNING *`, [pid]);
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "CANCELAR", entidad: "PROPIETARIO", registroId: pid, antes: prev, despues: rows[0] });
    await revocarYEliminarImagen(c, pid, res.locals.cuentaId, false);
    return rows[0];
  });
  res.json(row);
}));

// Historial de cambios del propietario (materializado desde auditoría)
r.get("/:id/historial", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  const { rows } = await pool.query(
    `SELECT id, fecha, accion, cuenta_id, datos_anteriores, datos_nuevos
     FROM auditoria_accion WHERE entidad='PROPIETARIO' AND registro_id=$1 ORDER BY fecha, id`, [pid]);
  res.json(rows);
}));

// ---------- Asociación propietario <-> unidad ----------
r.post("/:id/unidades/:unidadId", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id), uid = id.parse(req.params.unidadId);
  await withTx(async (c) => {
    const p = (await c.query(`SELECT estado FROM propietario WHERE id=$1`, [pid])).rows[0];
    if (!p) throw new HttpError(404, "Propietario no encontrado");
    if (p.estado !== "ACTIVO") throw new HttpError(409, "El propietario está cancelado");
    const u = (await c.query(`SELECT estado FROM unidad_residencial WHERE id=$1`, [uid])).rows[0];
    if (!u) throw new HttpError(404, "Unidad no encontrada");
    if (u.estado !== "ACTIVA") throw new HttpError(409, "La unidad está cancelada");
    await c.query(`INSERT INTO propietario_unidad (propietario_id, unidad_id) VALUES ($1,$2)`, [pid, uid]);
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "MODIFICAR", entidad: "PROPIETARIO", registroId: pid, despues: { unidadAsociada: uid } });
  });
  res.status(201).json({ propietarioId: pid, unidadId: uid });
}));

r.delete("/:id/unidades/:unidadId", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id), uid = id.parse(req.params.unidadId);
  await withTx(async (c) => {
    const del = await c.query(`DELETE FROM propietario_unidad WHERE propietario_id=$1 AND unidad_id=$2`, [pid, uid]);
    if (!del.rowCount) throw new HttpError(404, "Asociación no encontrada");
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "MODIFICAR", entidad: "PROPIETARIO", registroId: pid, antes: { unidadAsociada: uid } });
  });
  res.status(204).end();
}));

// ---------- Imagen facial (dato sensible) ----------
// Registrar autorización expresa del titular
r.post("/:id/imagen-facial/autorizacion", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  const { evidencia } = z.object({ evidencia: z.string().optional() }).parse(req.body ?? {});
  const row = await withTx(async (c) => {
    const p = (await c.query(`SELECT estado FROM propietario WHERE id=$1`, [pid])).rows[0];
    if (!p) throw new HttpError(404, "Propietario no encontrado");
    if (p.estado !== "ACTIVO") throw new HttpError(409, "El propietario está cancelado");
    const { rows } = await c.query(
      `INSERT INTO autorizacion_imagen (propietario_id, evidencia, registrada_por) VALUES ($1,$2,$3) RETURNING *`,
      [pid, evidencia ?? null, res.locals.cuentaId]);
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "CREAR", entidad: "AUTORIZACION_IMAGEN", registroId: rows[0].id, despues: rows[0] });
    return rows[0];
  });
  res.status(201).json(row);
}));

// Revocatoria: elimina la imagen y deja registro
r.delete("/:id/imagen-facial/autorizacion", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  await withTx((c) => revocarYEliminarImagen(c, pid, res.locals.cuentaId, true));
  res.status(204).end();
}));

// Cargar o reemplazar la imagen (una sola vigente)
r.put("/:id/imagen-facial", upload.single("imagen"), asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  if (!req.file) throw new HttpError(400, "Se requiere el campo 'imagen' (JPEG o PNG, máx. 2 MB)");
  const aut = await autorizacionVigente(pid);
  if (!aut) throw new HttpError(403, "No existe autorización expresa vigente del titular");
  const file = req.file;
  const out = await withTx(async (c) => {
    const prev = (await c.query(`SELECT id FROM imagen_facial_propietario WHERE propietario_id=$1`, [pid])).rows[0];
    const { rows } = await c.query(
      `INSERT INTO imagen_facial_propietario (propietario_id, autorizacion_id, contenido, mime_type)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (propietario_id) DO UPDATE
         SET contenido=EXCLUDED.contenido, mime_type=EXCLUDED.mime_type, autorizacion_id=EXCLUDED.autorizacion_id,
             habilitada_acceso=TRUE, updated_at=now()
       RETURNING id, propietario_id, mime_type, habilitada_acceso, updated_at`,
      [pid, aut.id, file.buffer, file.mimetype]);
    await registrarAuditoria(c, {
      cuentaId: res.locals.cuentaId, accion: prev ? "MODIFICAR" : "CREAR",
      entidad: "IMAGEN_FACIAL_PROPIETARIO", registroId: rows[0].id,
      despues: { propietarioId: pid, mimeType: file.mimetype, bytes: file.size },
    });
    return rows[0];
  });
  res.json(out);
}));

// Consulta desde el punto de acceso: solo con autorización vigente e imagen habilitada
r.get("/:id/imagen-facial", asyncH(async (req, res) => {
  const pid = id.parse(req.params.id);
  const aut = await autorizacionVigente(pid);
  if (!aut) throw new HttpError(403, "Consulta deshabilitada: no hay autorización vigente");
  const { rows } = await pool.query(
    `SELECT contenido, mime_type FROM imagen_facial_propietario WHERE propietario_id=$1 AND habilitada_acceso`, [pid]);
  if (!rows[0]) throw new HttpError(404, "Imagen no encontrada");
  res.type(rows[0].mime_type).send(rows[0].contenido);
}));

export default r;
