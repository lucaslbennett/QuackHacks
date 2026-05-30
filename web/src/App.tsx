import { useState } from "react";
import AuthProvider from "./components/AuthProvider";
import AnimatedBackground from "./components/AnimatedBackground";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import AuthModal, { type AuthMode } from "./components/AuthModal";
import Dashboard from "./components/Dashboard";
import TestPanel from "./components/TestPanel";

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);

  return (
    <AuthProvider>
      <div className="relative min-h-screen overflow-hidden bg-white">
        <AnimatedBackground />
        <Navbar
          onAuth={setAuthMode}
          onDashboard={() => setShowDashboard(true)}
        />
        <Hero onGetStarted={() => setAuthMode("signup")} />
        <TestPanel />
        {authMode && (
          <AuthModal
            mode={authMode}
            onClose={() => setAuthMode(null)}
            onSwitchMode={setAuthMode}
            onSuccess={() => {
              setAuthMode(null);
              setShowDashboard(true);
            }}
          />
        )}
        {showDashboard && (
          <Dashboard onClose={() => setShowDashboard(false)} />
        )}
      </div>
    </AuthProvider>
  );
}
