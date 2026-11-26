import type { DatabaseTransaction } from "@repo/db";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { memberAc } from "better-auth/plugins/organization/access";
import { createAuthAdapter } from "./better-auth";

const departments = organization({
  allowUserToCreateOrganization: false,
  membershipLimit: Number.POSITIVE_INFINITY,
  roles: { member: memberAc, supervisor: memberAc },
});

/** 认证写入使用调用方已开启的事务，内部开户不创建登录会话。 */
export function createAccountProvisioning(tx: DatabaseTransaction) {
  const auth = betterAuth({
    database: createAuthAdapter(tx),
    emailAndPassword: { enabled: true, autoSignIn: false },
    plugins: [departments],
  });

  return {
    async registerAccount(input: {
      email: string;
      name: string;
      password: string;
    }) {
      const { user } = await auth.api.signUpEmail({ body: input });
      return { id: user.id };
    },
    addOrganizationMember(input: {
      organizationId: string;
      userId: string;
      role: "member" | "supervisor";
    }) {
      return auth.api.addMember({ body: input });
    },
  };
}
