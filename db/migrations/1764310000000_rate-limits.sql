-- Up Migration
-- rf: expand-only
-- T24: the sign-in, second-step and password limits kept in Postgres, so a restart (or a second copy of the app)
-- does not give a guesser a fresh start. Not per company: the sign-in form runs before anyone is known.
-- squawk-ignore-file ban-drop-column, ban-drop-table, prefer-bigint-over-int, prefer-robust-stmts
SET lock_timeout = '5s';
SET statement_timeout = '30s';

CREATE TABLE rate_limits (
  key text PRIMARY KEY CHECK (length(key) <= 200),
  attempts integer NOT NULL,
  -- epoch milliseconds when the window ends
  reset_at bigint NOT NULL
);
CREATE INDEX ix_rate_limits_reset ON rate_limits (reset_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limits TO routeflow_app;

-- Down Migration
DROP TABLE rate_limits;
