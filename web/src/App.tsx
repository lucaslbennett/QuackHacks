import { useState } from "react";
import AuthProvider from "./components/AuthProvider";
import AnimatedBackground from "./components/AnimatedBackground";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import AuthModal, { type AuthMode } from "./components/AuthModal";
import Dashboard from "./components/Dashboard";
import GenerateScreen from "./components/GenerateScreen";
import TestPanel from "./components/TestPanel";

export default function App() {
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [showDashboard, setShowDashboard] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState<string | null>(null);

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
            <AnimatedBackground />
            <Hero onGenerate={setGeneratePrompt} />
            <TestPanel />
          </>
        )}

        {generatePrompt && (
          <GenerateScreen
            prompt={generatePrompt}
            onClose={() => setGeneratePrompt(null)}
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
              // If a generation is in progress, stay on it so the user can now
              // save; otherwise land on the dashboard.
              if (!generatePrompt) setShowDashboard(true);
            }}
          />
        )}
      </div>
    </AuthProvider>
  );
}
