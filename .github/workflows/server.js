// ════════════════════════════════════════════════════════════════
//  MEVUH PUSH NOTIFICATION SERVER
//  Deploy on Railway — handles Web Push for Mevuh health tracker
// ════════════════════════════════════════════════════════════════
const express    = require("express");
const webpush    = require("web-push");
const bodyParser = require("body-parser");
const cron       = require("node-cron");

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — allow your Netlify site ──────────────────────────────
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin",  "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});
app.use(bodyParser.json());

// ── VAPID KEYS (set these in Railway environment variables) ──────
// Run once locally: node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k);"
// Then paste the output into Railway → Variables
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || "mailto:mevuh@health.app";
const ADMIN_SECRET  = process.env.ADMIN_SECRET || "mevuh_secret_2025"; // change this!

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.error("❌  Missing VAPID keys! Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in Railway Variables.");
} else {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
  console.log("✅  VAPID keys loaded.");
}

// ── IN-MEMORY STORE (persists while server runs) ─────────────────
// Railway's free tier restarts occasionally — subscriptions re-register on next app open
let subscription    = null;   // one device (her phone)
let reminderSettings = {
  enabled: false,
  morningEnabled: false, morningTime: "08:00", morningMsg: "Good morning! Start your day strong 🌸",
  eveningTime: "18:00",  eveningMsg:  "Time for your evening workout & snack! 💪",
  nightTime:   "21:00",  nightMsg:    "Log your dinner & night drink. Sleep is your superpower 😴",
  timezone: "Asia/Kolkata"   // IST — Gujarat
};

// ── HELPERS ──────────────────────────────────────────────────────
function authCheck(req, res) {
  const secret = req.headers["x-admin-secret"] || req.body?.adminSecret;
  if (secret !== ADMIN_SECRET) { res.status(403).json({ error: "Forbidden" }); return false; }
  return true;
}

async function sendPush(title, body, url) {
  if (!subscription) return { ok: false, reason: "No subscription registered" };
  const payload = JSON.stringify({ title, body, url: url || "/" });
  try {
    await webpush.sendNotification(subscription, payload);
    console.log(`📨  Push sent: "${title}"`);
    return { ok: true };
  } catch (err) {
    console.error("Push error:", err.statusCode, err.message);
    if (err.statusCode === 410 || err.statusCode === 404) {
      subscription = null; // subscription expired, clear it
    }
    return { ok: false, reason: err.message };
  }
}

// ── CRON JOBS — daily scheduled reminders ────────────────────────
// Runs every minute, checks if current time matches reminder time (IST)
let cronJobs = [];

function rebuildCrons() {
  // Cancel existing
  cronJobs.forEach(j => j.stop());
  cronJobs = [];

  if (!reminderSettings.enabled) return;

  const tz = reminderSettings.timezone || "Asia/Kolkata";

  const schedule = (timeStr, title, body) => {
    const [h, m] = timeStr.split(":").map(Number);
    // cron format: minute hour * * *
    const job = cron.schedule(`${m} ${h} * * *`, () => {
      sendPush(title, body).catch(console.error);
    }, { timezone: tz });
    cronJobs.push(job);
    console.log(`⏰  Cron set: ${timeStr} (${tz}) — "${title}"`);
  };

  if (reminderSettings.morningEnabled) {
    schedule(
      reminderSettings.morningTime,
      "🌅 Good Morning — Mevuh 🩶",
      reminderSettings.morningMsg
    );
  }
  schedule(
    reminderSettings.eveningTime,
    "🌆 Evening Check-in — Mevuh 🩶",
    reminderSettings.eveningMsg
  );
  schedule(
    reminderSettings.nightTime,
    "🌙 Night Wind-down — Mevuh 🩶",
    reminderSettings.nightMsg
  );
}

// ════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "Mevuh Push Server 🩶",
    subscribed: !!subscription,
    remindersEnabled: reminderSettings.enabled,
    cronJobs: cronJobs.length
  });
});

// Get VAPID public key (needed by frontend to subscribe)
app.get("/vapid-public-key", (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// Register subscription (called when she allows notifications)
app.post("/subscribe", (req, res) => {
  const sub = req.body.subscription;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: "Invalid subscription" });
  subscription = sub;
  console.log("📱  New subscription registered:", sub.endpoint.slice(-30));
  res.json({ ok: true });
});

// Delete subscription
app.delete("/subscribe", (req, res) => {
  subscription = null;
  res.json({ ok: true });
});

// Save reminder settings (called when she saves from app)
app.post("/reminder-settings", (req, res) => {
  reminderSettings = { ...reminderSettings, ...req.body };
  rebuildCrons();
  try { localStorage.setItem("mevuh_reminders", JSON.stringify(reminderSettings)); } catch(_){}
  res.json({ ok: true, settings: reminderSettings });
});

// ── ADMIN ROUTES (protected by ADMIN_SECRET) ────────────────────

// Send a custom push right now (from your hidden admin panel)
app.post("/admin/send-now", async (req, res) => {
  if (!authCheck(req, res)) return;
  const { title, body, url } = req.body;
  if (!body) return res.status(400).json({ error: "body is required" });
  const result = await sendPush(title || "Mevuh 🩶", body, url);
  res.json(result);
});

// Schedule a one-off push at a specific time today
app.post("/admin/schedule-once", (req, res) => {
  if (!authCheck(req, res)) return;
  const { title, body, time } = req.body; // time = "HH:MM"
  if (!body || !time) return res.status(400).json({ error: "body and time required" });

  const [h, m] = time.split(":").map(Number);
  const tz = reminderSettings.timezone || "Asia/Kolkata";

  // Schedule one-time cron (runs once at the specified time today)
  const job = cron.schedule(`${m} ${h} * * *`, async () => {
    await sendPush(title || "Mevuh 🩶", body);
    job.stop(); // one-time only
    cronJobs = cronJobs.filter(j => j !== job);
  }, { timezone: tz });

  cronJobs.push(job);
  console.log(`⚡  One-time push scheduled: ${time} — "${title}"`);
  res.json({ ok: true, scheduled: time });
});

// Get server status (admin)
app.get("/admin/status", (req, res) => {
  if (!authCheck(req, res)) return;
  res.json({
    subscribed: !!subscription,
    endpoint: subscription?.endpoint?.slice(-40) || null,
    reminders: reminderSettings,
    activeCrons: cronJobs.length
  });
});

// ── START ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🩶  Mevuh Push Server running on port ${PORT}`);
  rebuildCrons(); // restore crons on restart
});
