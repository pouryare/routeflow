import { ROLES, type Role } from "@/lib/roles";

/** F26/F88: everyone who works for the company may claim a cost they paid; a shareholder is not staff. */
export const CLAIM_ROLES: Role[] = ROLES.filter((r) => r !== "shareholder");
