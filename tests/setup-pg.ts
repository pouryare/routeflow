/* The unit suite runs on PostgreSQL only, through scripts/pg/test-pg.mjs (`npm test`), which
   builds the template database every test file copies. Run bare, vitest would find no database
   and fail in the first query of every file; say why once instead. */
if (!process.env.ROUTEFLOW_PG_TEMPLATE) {
  throw new Error("Run the tests with `npm test` (DATABASE_URL set to a PostgreSQL server you may create databases on): it builds the template database the files copy.");
}
