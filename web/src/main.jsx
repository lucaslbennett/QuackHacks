import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Onboard from "./pages/Onboard.jsx";
import Influencer from "./pages/Influencer.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route index element={<Dashboard />} />
          <Route path="onboard" element={<Onboard />} />
          <Route path="influencer/:id" element={<Influencer />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
