import React from "react";
import { createRoot } from "react-dom/client";
import InSightWindStation from "./App.jsx";

function App() {
  return (
    <div style={{ width: "100%", height: "100vh", background: "black", color: "white" }}>
      <InSightWindStation apiKey="E3yrARvpO7o5yH2vrAkEEP7L3tQ4ztRVdpZxPSFk" />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);