import BackgroundVideo from "./components/BackgroundVideo";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import LogoCloud from "./components/LogoCloud";
import Features from "./components/Features";
import HowItWorks from "./components/HowItWorks";
import Showcase from "./components/Showcase";
import Stats from "./components/Stats";
import Pricing from "./components/Pricing";
import FAQ from "./components/FAQ";
import CTA from "./components/CTA";
import Footer from "./components/Footer";

export default function App() {
  return (
    <div className="relative min-h-screen bg-black">
      <BackgroundVideo />
      <Navbar />
      <Hero />

      {/* Content below the hero — solid background covers the fixed video */}
      <main className="relative z-[1] bg-black">
        <LogoCloud />
        <Features />
        <HowItWorks />
        <Showcase />
        <Stats />
        <Pricing />
        <FAQ />
        <CTA />
        <Footer />
      </main>
    </div>
  );
}
