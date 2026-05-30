import { useEffect, useState, type ReactNode } from "react";
import * as authApi from "../lib/auth";
import type { User } from "../lib/auth";
import { AuthContext } from "../lib/authContext";

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount, restore the session from any stored token.
  useEffect(() => {
    let active = true;
    authApi.fetchMe().then((u) => {
      if (active) {
        setUser(u);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const { user } = await authApi.login(email, password);
    setUser(user);
  };

  const register = async (email: string, password: string, name?: string) => {
    const { user } = await authApi.register(email, password, name);
    setUser(user);
  };

  const logout = async () => {
    await authApi.logout();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
