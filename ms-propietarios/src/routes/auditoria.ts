import { Router } from "express";
import { pool } from "../config/db";
import { asyncH } from "../middleware/errors";

const r = Router();

r.get("/", asyncH(async (req, res) => {
  const { entidad, registroId, cuentaId, accion, desde, hasta } = req.query as Record<string, string | undefined>;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const { rows } = await pool.query(
    `SELECT * FROM auditoria_accion
     WHERE ($1::text IS NULL OR entidad=$1) AND ($2::text IS NULL OR registro_id=$2)
       AND ($3::text IS NULL OR cuenta_id=$3) AND ($4::text IS NULL OR accion=$4)
       AND ($5::timestamptz IS NULL OR fecha>=$5) AND ($6::timestamptz IS NULL OR fecha<=$6)
     ORDER BY fecha DESC, id DESC LIMIT $7`,
    [entidad ?? null, registroId ?? null, cuentaId ?? null, accion ?? null, desde ?? null, hasta ?? null, limit]);
  res.json(rows);
}));

export default r;
