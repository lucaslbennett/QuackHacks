import { useEffect, useState } from "react";
import { useAuth } from "../lib/authContext";

export type AuthMode = "login" | "signup";

interface AuthModalProps {
  mode: AuthMode;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  onSuccess: () => void;
}

export default function AuthModal({
  mode,
  onClose,
  onSwitchMode,
  onSuccess,
}: AuthModalProps) {
  const { login, register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isSignup = mode === "signup";

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (isSignup) {
        await register(email, password, name.trim());
      } else {
        await login(email, password);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-black/10 bg-white p-7 text-black shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          className="mb-1 text-[28px] leading-tight"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {isSignup ? "Create your account" : "Welcome back"}
        </h2>
        <p className="mb-6 text-[13px] text-black/50">
          {isSignup
            ? "Sign up to get started with Fasto."
            : "Log in to your Fasto account."}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {isSignup && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="name"
              className="rounded-lg border border-black/15 bg-black/5 px-4 py-2.5 text-[14px] text-black placeholder-black/40 outline-none transition-colors focus:border-black/40"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            className="rounded-lg border border-black/15 bg-black/5 px-4 py-2.5 text-[14px] text-black placeholder-black/40 outline-none transition-colors focus:border-black/40"
          />
          <input
            type="password"
            placeholder={isSignup ? "Password (min 8 characters)" : "Password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isSignup ? 8 : undefined}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className="rounded-lg border border-black/15 bg-black/5 px-4 py-2.5 text-[14px] text-black placeholder-black/40 outline-none transition-colors focus:border-black/40"
          />

          {error && <p className="text-[13px] text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 rounded-full bg-black px-4 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {submitting
              ? "Please wait…"
              : isSignup
                ? "Sign Up"
                : "Log In"}
          </button>
        </form>

        <p className="mt-5 text-center text-[13px] text-black/50">
          {isSignup ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => {
              setError(null);
              onSwitchMode(isSignup ? "login" : "signup");
            }}
            className="text-black underline underline-offset-2 hover:opacity-70"
          >
            {isSignup ? "Log in" : "Sign up"}
          </button>
        </p>
      </div>
    </div>
  );
}
