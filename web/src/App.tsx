import { useEffect, useState } from "react";
import AuthProvider from "./components/AuthProvider";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import AuthModal, { type AuthMode } from "./components/AuthModal";
import Dashboard from "./components/Dashboard";
import InfluencerDetail from "./components/InfluencerDetail";
import Onboarding from "./components/Onboarding";
import TestPanel from "./components/TestPanel";
import type { Generation } from "./lib/generate";

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  // The influencer whose detail page is open (null = dashboard grid view).
  const [selectedInfluencer, setSelectedInfluencer] =
    useState<Generation | null>(null);
  // null = closed; string (possibly empty) = onboarding open, seeded with the
  // text the user typed in the hero composer.
  const [onboardSeed, setOnboardSeed] = useState<string | null>(null);

  // Leaving onboarding simply unmounts it, which discards all in-progress
  // state (answers, generated character) since nothing is persisted until the
  // user explicitly saves.
  const closeOnboarding = () => setOnboardSeed(null);

  const goHome = () => {
    setShowDashboard(false);
    setSelectedInfluencer(null);
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

  // Same pattern for the influencer detail page: browser Back returns to the
  // dashboard grid rather than leaving the app.
  const detailOpen = selectedInfluencer !== null;
  useEffect(() => {
    if (!detailOpen) return;
    window.history.pushState({ influencerDetail: true }, "");
    const onPop = () => setSelectedInfluencer(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [detailOpen]);

  return (
    <AuthProvider>
      <div className="relative min-h-screen overflow-hidden bg-white">
        {/* Single, always-mounted header so it never shifts between tabs. */}
        <Navbar
          onAuth={setAuthMode}
          onDashboard={() => {
            setSelectedInfluencer(null);
            setShowDashboard(true);
          }}
          onHome={goHome}
          inDashboard={showDashboard}
        />

        {showDashboard ? (
          selectedInfluencer ? (
            <InfluencerDetail
              influencer={selectedInfluencer}
              onBack={() => setSelectedInfluencer(null)}
            />
          ) : (
            <Dashboard onSelectInfluencer={setSelectedInfluencer} />
          )
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
