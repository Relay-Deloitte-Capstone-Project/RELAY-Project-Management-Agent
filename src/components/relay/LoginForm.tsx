import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { login } from "@/lib/auth/functions";
import { roleHome } from "@/lib/auth/types";

const DEMO_ACCOUNTS = [
  { role: "Developer", name: "Akshar", email: "akshar@relay.dev" },
  { role: "Manager", name: "Adveita", email: "adveita@relay.dev" },
  { role: "Admin", name: "Anya", email: "anya@relay.dev" },
  { role: "Developer (on leave)", name: "Agrim", email: "agrim@relay.dev" },
] as const;

export function LoginForm({ redirectTo }: { redirectTo: string | undefined }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const result = await login({ data: { email, password } });
      navigate({ to: redirectTo || roleHome(result.user.role) });
    } catch {
      setError("Invalid email or password");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-[400px] rounded-xl border border-border bg-card p-10 shadow-xl">
      <span className="font-mono text-[14px] tracking-[3px] text-ink uppercase">
        Relay
        <span className="ml-1.5 inline-block size-1.5 rounded-full bg-brand align-middle" />
      </span>

      <h1 className="mt-6 text-[22px] font-semibold text-ink">Sign in</h1>
      <p className="mt-1 text-[13px] text-mute">Use your Relay credentials.</p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@relay.dev"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-mute focus:border-brand"
        />

        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 pr-10 text-[13px] text-ink outline-none transition-colors duration-150 placeholder:text-mute focus:border-brand"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-3 -translate-y-1/2 text-mute hover:text-ink [&_svg]:size-4"
          >
            {showPassword ? <EyeOff /> : <Eye />}
          </button>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="mt-2 h-11 w-full rounded-lg bg-brand text-[14px] font-medium text-brand-foreground transition-transform duration-100 active:scale-[0.98] disabled:opacity-60"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>

        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
      </form>

      <div className="mt-8 border-t border-border pt-5">
        <p className="text-[11px] text-mute">Team accounts (all use password: relay2026)</p>
        <div className="mt-2 flex flex-col gap-1">
          {DEMO_ACCOUNTS.map((acct) => (
            <button
              key={acct.email}
              type="button"
              onClick={() => setEmail(acct.email)}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-150 hover:bg-surface-sunken"
            >
              <span className="text-mute">
                {acct.role} · {acct.name}
              </span>
              <span className="font-mono text-[11px] text-brand">{acct.email}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
