import BackgroundVideo from "./components/BackgroundVideo";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";

export default function App() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white">
      <BackgroundVideo />
      <Navbar />
      <Hero />
    </div>
  );
}
