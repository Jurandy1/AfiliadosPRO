// public/sw-unregister.js
// Desregistra qualquer Service Worker antigo automaticamente
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister();
      console.log("[SW] Service Worker desregistrado:", registration.scope);
    }
  });
}
