import "dotenv/config";
import express from "express";
import { cuentaResponsable } from "./middleware/cuenta";
import { errorHandler } from "./middleware/errors";
import propietarios from "./routes/propietarios";
import unidades from "./routes/unidades";
import auditoria from "./routes/auditoria";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", servicio: "ms-propietarios" }));

app.use("/api", cuentaResponsable);
app.use("/api/propietarios", propietarios);
app.use("/api/unidades", unidades);
app.use("/api/auditoria", auditoria);

app.use(errorHandler);

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => console.log(`MS-Propietarios escuchando en :${port}`));
