import { useEffect, useState } from "react";
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

  // Leaving onboarding simply unmounts it, which discards all in-progress
  // state (answers, generated character) since nothing is persisted until the
  // user explicitly saves.
  const closeOnboarding = () => setOnboardSeed(null);

  const goHome = () => {
    setShowDashboard(false);
    closeOnboarding();
  };

  // Let the browser Back button close onboarding instead of leaving the page.
  // We push a dedicated history entry when onboarding opens; pressing Back pops
  // it and triggers popstate, which we use to close the overlay.
  const onboardingOpen = onboardSeed !== null;
  useEffect(() => {
    if (!onboardingOpen) return;
    window.history.pushState({ onboarding: true }, "");
    const onPop = () => setOnboardSeed(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [onboardingOpen]);

  return (
    <AuthProvider>
      <div className="relative min-h-screen overflow-hidden bg-white">
        {/* Single, always-mounted header so it never shifts between tabs. */}
        <Navbar
          onAuth={setAuthMode}
          onDashboard={() => setShowDashboard(true)}
          onHome={goHome}
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
            onClose={closeOnboarding}
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
