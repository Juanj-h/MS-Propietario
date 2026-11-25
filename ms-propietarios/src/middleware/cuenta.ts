import { NextFunction, Request, Response } from "express";

// Identifica la cuenta responsable de la acción (autenticada en MS-Acceso).
// TODO: reemplazar por validación del JWT emitido por MS-Acceso y leer el id de la cuenta del token.
export function cuentaResponsable(req: Request, res: Response, next: NextFunction) {
  const cuenta = req.header("x-cuenta-id");
  if (!cuenta && req.method !== "GET") {
    return res.status(401).json({ error: "Falta la cuenta responsable (header x-cuenta-id)" });
  }
  res.locals.cuentaId = cuenta ?? "anonimo";
  next();
}
