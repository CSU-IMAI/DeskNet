import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { DesktopSearch } from "./components/DesktopSearch";
import { QuickSearch } from "./components/QuickSearch";
import { ZoneWidget } from "./components/ZoneWidget";
import { isDesktopRuntime } from "./lib/api";
import "./styles.css";

let windowLabel = "main";
if (isDesktopRuntime) {
  try {
    windowLabel = getCurrentWindow().label;
  } catch {
    windowLabel = "main";
  }
}
document.documentElement.dataset.window = windowLabel;

try {
  const stored = localStorage.getItem("desknest.theme");
  const theme = stored
    ? (JSON.parse(stored) as "light" | "dark")
    : window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  document.documentElement.dataset.theme = theme;
} catch {
  document.documentElement.dataset.theme = "light";
}

const content =
  windowLabel === "quick-search" ? (
    <QuickSearch />
  ) : windowLabel === "desktop-search" ? (
    <DesktopSearch />
  ) : windowLabel.startsWith("zone-") ? (
    <ZoneWidget />
  ) : (
    <App />
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{content}</StrictMode>,
);
