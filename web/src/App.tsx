import { useState } from "react";
import AuthProvider from "./components/AuthProvider";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import AuthModal, { type AuthMode } from "./components/AuthModal";

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);

  return (
    <AuthProvider>
      <div className="relative min-h-screen overflow-hidden bg-black">
        <Navbar onAuth={setAuthMode} />
        <Hero />
        {authMode && (
          <AuthModal
            mode={authMode}
            onClose={() => setAuthMode(null)}
            onSwitchMode={setAuthMode}
          />
        )}
      </div>
    </AuthProvider>
  );
}
