import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export function createDatabase(url: string) {
  const client = postgres(url, { connect_timeout: 5 });
  const db = drizzle(client);

  return {
    db,
    checkConnection: () => db.execute(sql`SELECT 1`),
    close: () => client.end(),
  };
}
