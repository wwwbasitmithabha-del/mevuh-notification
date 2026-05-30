// ════════════════════════════════════════════════════════════════
//  MEVUH SERVICE WORKER  —  sw.js
//  Place this file at the ROOT of your Netlify site (same folder as index.html)
//  This is what makes notifications work even when the app is closed
// ════════════════════════════════════════════════════════════════

const CACHE_NAME = "mevuh-v1";
const NOTIF_ICON = "https://em-content.zobj.net/source/google/387/grey-heart_1f90d.png";
const APP_URL    = self.registration.scope;

// ── INSTALL & ACTIVATE ───────────────────────────────────────────
self.addEventListener("install", e => {
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(clients.claim());
});

// ── PUSH EVENT — fires when server sends a push ──────────────────
self.addEventListener("push", e => {
  let data = { title: "Mevuh 🩶", body: "You have a new reminder!", url: "/" };
  try {
    if (e.data) data = { ...data, ...JSON.parse(e.data.text()) };
  } catch (_) {}

  const options = {
    body:              data.body,
    icon:              NOTIF_ICON,
    badge:             NOTIF_ICON,
    vibrate:           [200, 100, 200],
    tag:               "mevuh-notif",          // replaces previous if still showing
    renotify:          true,
    requireInteraction: false,
    data:              { url: data.url || APP_URL },
    actions: [
      { action: "open",    title: "Open Mevuh" },
      { action: "dismiss", title: "Dismiss"    }
    ]
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── NOTIFICATION CLICK — open app when tapped ───────────────────
self.addEventListener("notificationclick", e => {
  e.notification.close();

  if (e.action === "dismiss") return;

  const targetUrl = (e.notification.data && e.notification.data.url) || APP_URL;

  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      // If app is already open, focus it
      for (const client of list) {
        if (client.url.includes(self.registration.scope) && "focus" in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
