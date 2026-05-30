import { useState } from "react";
import AuthProvider from "./components/AuthProvider";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import AuthModal, { type AuthMode } from "./components/AuthModal";
import Dashboard from "./components/Dashboard";
import Onboarding from "./components/Onboarding";
import TestPanel from "./components/TestPanel";

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  // null = closed; string (possibly empty) = onboarding open, seeded with the
  // text the user typed in the hero composer.
  const [onboardSeed, setOnboardSeed] = useState<string | null>(null);

  return (
    <AuthProvider>
      <div className="relative min-h-screen overflow-hidden bg-white">
        {/* Single, always-mounted header so it never shifts between tabs. */}
        <Navbar
          onAuth={setAuthMode}
          onDashboard={() => setShowDashboard(true)}
          onHome={() => setShowDashboard(false)}
          inDashboard={showDashboard}
        />

        {showDashboard ? (
          <Dashboard />
        ) : (
          <>
            <Hero onGenerate={setOnboardSeed} />
            <TestPanel />
          </>
        )}

        {onboardSeed !== null && (
          <Onboarding
            seed={onboardSeed}
            onClose={() => setOnboardSeed(null)}
            onComplete={() => {
              setOnboardSeed(null);
              setShowDashboard(true);
            }}
            onRequireSignIn={() => setAuthMode("signup")}
          />
        )}

        {authMode && (
          <AuthModal
            mode={authMode}
            onClose={() => setAuthMode(null)}
            onSwitchMode={setAuthMode}
            onSuccess={() => {
              setAuthMode(null);
              // If onboarding is open, stay on it so the user can now launch
              // their influencer; otherwise land on the dashboard.
              if (onboardSeed === null) setShowDashboard(true);
            }}
          />
        )}
      </div>
    </AuthProvider>
  );
}
