export const ROLES = ["DEVELOPER", "MANAGER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  initials: string;
  avatarColor: string;
};

export function roleHome(role: Role): string {
  if (role === "MANAGER") return "/mgr/dashboard";
  if (role === "ADMIN") return "/admin/dashboard";
  return "/dev/work";
}
