import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/auth/functions";

export function SignOutButton() {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    await logout();
    navigate({ to: "/login" });
  };

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className="flex w-full items-center gap-2 px-5 py-2 text-[12px] text-sidebar-muted transition-colors duration-150 hover:text-danger disabled:opacity-50 [&_svg]:size-3.5"
    >
      <LogOut />
      Sign out
    </button>
  );
}
