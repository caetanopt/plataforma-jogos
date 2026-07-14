import type { DefaultSession } from "next-auth";

// Session/User e JWT são apenas reexportados por "next-auth" e "next-auth/jwt";
// as interfaces reais vivem em "@auth/core", que é onde o TypeScript aplica o
// merge de declarações.
declare module "@auth/core/types" {
  interface User {
    id: string;
    isSuperAdmin: boolean;
    activeOrganizationId: string | null;
  }

  interface Session {
    user: {
      id: string;
      isSuperAdmin: boolean;
      activeOrganizationId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: string;
    isSuperAdmin: boolean;
    activeOrganizationId: string | null;
  }
}
