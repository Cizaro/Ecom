-- The append-only guard used SQLSTATE 23001 (restrict_violation), which database
-- clients report as a foreign-key error. Use the generic raise_exception code so
-- the message reaches logs and callers unchanged.
CREATE OR REPLACE FUNCTION app.reject_modification() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END
$$;
