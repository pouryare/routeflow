import { describe, it, expect } from "vitest";
// @ts-expect-error plain ESM script helper
import { databaseName } from "../scripts/_db.mjs";

describe("databaseName", () => {
  it("reads the database from the server's own connection string, which new URL() rejects", () => {
    expect(databaseName("postgres://web:pw@/routeflow?host=/var/run/postgresql")).toBe("routeflow");
  });
  it("reads ordinary and socket-only forms, and falls back to postgres", () => {
    expect(databaseName("postgres://u:p@db.example:5432/shop")).toBe("shop");
    expect(databaseName("postgres:///routeflow?host=/var/run/postgresql")).toBe("routeflow");
    expect(databaseName("postgres://u:p@db.example:5432")).toBe("postgres");
  });
});
