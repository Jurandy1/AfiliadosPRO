import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Desregistra Service Workers antigos
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((r) => r.unregister());
  });
}

// Limpa caches do browser API antigos (Workbox, etc)
if ("caches" in window) {
  caches.keys().then((names) => {
    names.forEach((name) => caches.delete(name));
  });
}

function renderFatal(error) {
  const err = error?.reason || error?.error || error;
  const text = err?.stack || err?.message || String(err || "Erro desconhecido");
  const pre = document.createElement("pre");
  pre.style.whiteSpace = "pre-wrap";
  pre.style.padding = "16px";
  pre.style.margin = "0";
  pre.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
  pre.style.fontSize = "12px";
  pre.style.background = "#fff";
  pre.style.color = "#111827";
  pre.textContent = text;
  document.body.innerHTML = "";
  document.body.appendChild(pre);
}

window.addEventListener("error", (e) => renderFatal(e));
window.addEventListener("unhandledrejection", (e) => renderFatal(e));

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
} catch (e) {
  renderFatal(e);
}
