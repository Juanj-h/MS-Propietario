CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS unidad_residencial (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo        TEXT NOT NULL UNIQUE,            -- identificación única (ej. T1-APT-101)
  torre         TEXT,
  descripcion   TEXT,
  estado        TEXT NOT NULL DEFAULT 'ACTIVA' CHECK (estado IN ('ACTIVA','CANCELADA')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS propietario (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_documento    TEXT NOT NULL,
  numero_documento  TEXT NOT NULL,
  nombres           TEXT NOT NULL,
  apellidos         TEXT NOT NULL,
  email             TEXT NOT NULL UNIQUE,
  telefono          TEXT,
  estado            TEXT NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO','CANCELADO')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo_documento, numero_documento)
);

CREATE TABLE IF NOT EXISTS propietario_unidad (
  propietario_id   UUID NOT NULL REFERENCES propietario(id),
  unidad_id        UUID NOT NULL REFERENCES unidad_residencial(id),
  fecha_asociacion TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (propietario_id, unidad_id)
);

-- Autorización expresa y previa del titular para tratar su imagen facial
CREATE TABLE IF NOT EXISTS autorizacion_imagen (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id  UUID NOT NULL REFERENCES propietario(id),
  otorgada_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revocada_at     TIMESTAMPTZ,
  evidencia       TEXT,                           -- referencia al consentimiento firmado
  registrada_por  TEXT NOT NULL
);
-- Solo una autorización vigente por propietario
CREATE UNIQUE INDEX IF NOT EXISTS ux_autorizacion_vigente
  ON autorizacion_imagen (propietario_id) WHERE revocada_at IS NULL;

-- Una sola imagen vigente por propietario
CREATE TABLE IF NOT EXISTS imagen_facial_propietario (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  propietario_id    UUID NOT NULL UNIQUE REFERENCES propietario(id),
  autorizacion_id   UUID NOT NULL REFERENCES autorizacion_imagen(id),
  contenido         BYTEA NOT NULL,
  mime_type         TEXT NOT NULL,
  habilitada_acceso BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auditoria_accion (
  id                BIGSERIAL PRIMARY KEY,
  cuenta_id         TEXT NOT NULL,                -- cuenta responsable (MS-Acceso)
  accion            TEXT NOT NULL CHECK (accion IN ('CREAR','MODIFICAR','CANCELAR','ELIMINAR')),
  entidad           TEXT NOT NULL,
  registro_id       TEXT NOT NULL,
  datos_anteriores  JSONB,
  datos_nuevos      JSONB,
  fecha             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_auditoria_registro ON auditoria_accion (entidad, registro_id, fecha);
