import { Router } from "express";
import { z } from "zod";
import { pool, withTx } from "../config/db";
import { asyncH, HttpError } from "../middleware/errors";
import { registrarAuditoria } from "../services/auditoria";

const r = Router();
const id = z.string().uuid();

const crear = z.object({
  codigo: z.string().min(1),
  torre: z.string().optional(),
  descripcion: z.string().optional(),
});
const actualizar = crear.partial();

r.post("/", asyncH(async (req, res) => {
  const d = crear.parse(req.body);
  const row = await withTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO unidad_residencial (codigo, torre, descripcion) VALUES ($1,$2,$3) RETURNING *`,
      [d.codigo, d.torre ?? null, d.descripcion ?? null]);
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "CREAR", entidad: "UNIDAD_RESIDENCIAL", registroId: rows[0].id, despues: rows[0] });
    return rows[0];
  });
  res.status(201).json(row);
}));

r.get("/", asyncH(async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM unidad_residencial ORDER BY codigo`);
  res.json(rows);
}));

r.get("/:id", asyncH(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM unidad_residencial WHERE id=$1`, [id.parse(req.params.id)]);
  if (!rows[0]) throw new HttpError(404, "Unidad no encontrada");
  const props = await pool.query(
    `SELECT p.id, p.nombres, p.apellidos, p.estado FROM propietario p
     JOIN propietario_unidad pu ON pu.propietario_id = p.id WHERE pu.unidad_id=$1`, [rows[0].id]);
  res.json({ ...rows[0], propietarios: props.rows });
}));

r.put("/:id", asyncH(async (req, res) => {
  const uid = id.parse(req.params.id);
  const d = actualizar.parse(req.body);
  const row = await withTx(async (c) => {
    const prev = (await c.query(`SELECT * FROM unidad_residencial WHERE id=$1 FOR UPDATE`, [uid])).rows[0];
    if (!prev) throw new HttpError(404, "Unidad no encontrada");
    if (prev.estado === "CANCELADA") throw new HttpError(409, "La unidad está cancelada");
    const { rows } = await c.query(
      `UPDATE unidad_residencial SET codigo=$2, torre=$3, descripcion=$4, updated_at=now() WHERE id=$1 RETURNING *`,
      [uid, d.codigo ?? prev.codigo, d.torre ?? prev.torre, d.descripcion ?? prev.descripcion]);
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "MODIFICAR", entidad: "UNIDAD_RESIDENCIAL", registroId: uid, antes: prev, despues: rows[0] });
    return rows[0];
  });
  res.json(row);
}));

// Cancelación lógica
r.delete("/:id", asyncH(async (req, res) => {
  const uid = id.parse(req.params.id);
  const row = await withTx(async (c) => {
    const prev = (await c.query(`SELECT * FROM unidad_residencial WHERE id=$1 FOR UPDATE`, [uid])).rows[0];
    if (!prev) throw new HttpError(404, "Unidad no encontrada");
    if (prev.estado === "CANCELADA") throw new HttpError(409, "La unidad ya está cancelada");
    const { rows } = await c.query(
      `UPDATE unidad_residencial SET estado='CANCELADA', updated_at=now() WHERE id=$1 RETURNING *`, [uid]);
    await registrarAuditoria(c, { cuentaId: res.locals.cuentaId, accion: "CANCELAR", entidad: "UNIDAD_RESIDENCIAL", registroId: uid, antes: prev, despues: rows[0] });
    return rows[0];
  });
  res.json(row);
}));

export default r;
