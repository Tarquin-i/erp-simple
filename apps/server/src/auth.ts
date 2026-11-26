import { database } from "./database";
import { createIdentityModule } from "./modules/identity";

// Better Auth CLI discovers the named auth export when generating the schema.
export const { auth, requireAccountId } = createIdentityModule(database.db);
