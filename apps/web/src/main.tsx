import React from "react";
import { createRoot } from "react-dom/client";
import { ProductApp } from "./ProductApp.js";
import "./style.css";
import "./product.css";
import "./platform.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ProductApp />
  </React.StrictMode>,
);
