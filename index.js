// =======================
// Safe RSS-to-JSON API for news apps
// With OneSignal Real Push Notifications (AUTO BACKGROUND)
// =======================

require("dotenv").config();

const express = require("express");
const Parser = require("rss-parser");
const cors = require("cors");
const OneSignal = require("onesignal-node");
const cron = require("node-cron");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

// ================= RSS PARSER =================
const parser = new Parser({
  customFields: { item: ["media:content", "enclosure"] },
});

app.use(cors());

// ================= OneSignal =================
const oneSignalClient = new OneSignal.Client(
  process.env.ONESIGNAL_APP_ID,
  process.env.ONESIGNAL_REST_KEY
);

console.log(
  "🚀 OneSignal App ID:",
  process.env.ONESIGNAL_APP_ID ? "OK" : "❌ MISSING"
);

// ================= FEEDS =================
const FEEDS = [
  { name: "Baahrakhari", url: "https://baahrakhari.com/feed" },
  { name: "OnlineKhabar", url: "https://www.onlinekhabar.com/feed" },
  { name: "Ratopati", url: "https://www.ratopati.com/feed" },
  { name: "Setopati", url: "https://www.setopati.com/feed" },
  { name: "ThahaKhabar", url: "https://www.thahakhabar.com/feed" },
  { name: "NepalSamaya", url: "https://nepalsamaya.com/feed" },
  { name: "Rajdhani", url: "https://rajdhanidaily.com/feed" },
  { name: "NewsOfNepal", url: "https://newsofnepal.com/feed" },
  { name: "BizMandu", url: "https://bizmandu.com/feed" },
  { name: "Techpana", url: "https://techpana.com/feed" },
  { name: "Artha Dabali", url: "https://www.arthadabali.com/feed" },
  { name: "Makalu Khabar", url: "https://www.makalukhabar.com/feed" },
  { name: "SwasthyaKhabar", url: "https://swasthyakhabar.com/feed" },
  { name: "Nagarik News", url: "https://nagariknews.nagariknetwork.com/feed" },
  { name: "BBC Nepali", url: "https://www.bbc.com/nepali/index.xml" },
];

// ================= HELPERS =================
function cleanText(text = "") {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// ================= KEYWORDS =================
const HIGH_KEYWORDS = [
  "भूकम्प","बाढी","पहिरो","हिमपात","आगलागी","दुर्घटना","मृत्यु",
  "आपतकालीन","विस्फोट","प्रधानमन्त्री","पक्राउ","गणतन्त्र",
  "नरसंहार","आदेश","बेपत्ता","राशिफल",
];

// ================= PERSISTENT STORE =================
const STORE_FILE = "./notified.json";

let NOTIFIED = new Set();
if (fs.existsSync(STORE_FILE)) {
  NOTIFIED = new Set(JSON.parse(fs.readFileSync(STORE_FILE, "utf8")));
}

function saveNotified() {
  fs.writeFileSync(STORE_FILE, JSON.stringify([...NOTIFIED]));
}

function getHash(article) {
  return crypto
    .createHash("sha1")
    .update(article.title + article.link)
    .digest("hex");
}

// ================= SCORE =================
function getNewsScore(article) {
  let score = 0;
  const text = `${article.title} ${article.description}`;
  HIGH_KEYWORDS.forEach(k => {
    if (text.includes(k)) score += 5;
  });
  return score;
}

// ================= PUSH =================
async function sendPushNotification({ title, body, url }) {
  await oneSignalClient.createNotification({
    app_id: process.env.ONESIGNAL_APP_ID,
    headings: { en: title },
    contents: { en: body || "ताजा समाचार" },
    included_segments: ["All"],
    data: {
      click_action: "OPEN_NEWS",
      url,
      title,
    },
  });
}

// ================= PROCESS =================
let LAST_NOTIFICATION_TIME = 0;
const NOTIFY_COOLDOWN = 10 * 60 * 1000;

async function processNotifications(articles) {
  const now = Date.now();

  const important = articles
    .map(a => ({
      ...a,
      hash: getHash(a),
      score: getNewsScore(a),
    }))
    .filter(a => a.score >= 5)
    .filter(a => !NOTIFIED.has(a.hash));

  if (!important.length) return;
  if (now - LAST_NOTIFICATION_TIME < NOTIFY_COOLDOWN) return;

  const top = important.sort((a, b) => b.score - a.score)[0];

  await sendPushNotification({
    title: top.title,
    body: top.description,
    url: top.link,
  });

  important.forEach(a => NOTIFIED.add(a.hash));
  saveNotified();
  LAST_NOTIFICATION_TIME = now;

  console.log("🔔 Notification sent:", top.title);
}

// ================= BACKGROUND JOB =================
async function backgroundJob() {
  let articles = [];

  for (const feed of FEEDS) {
    try {
      const data = await parser.parseURL(feed.url);
      data.items.slice(0, 5).forEach(item => {
        if (item.link) {
          articles.push({
            title: cleanText(item.title),
            description: cleanText(item.contentSnippet || ""),
            link: item.link,
          });
        }
      });
    } catch (err) {
      console.error("❌ RSS error:", feed.url);
    }
  }

  await processNotifications(articles);
}

// ⏰ EVERY 5 MINUTES
cron.schedule("*/5 * * * *", backgroundJob);

// ================= API =================
app.get("/news", async (req, res) => {
  let articles = [];

  for (const feed of FEEDS) {
    try {
      const data = await parser.parseURL(feed.url);
      data.items.slice(0, 10).forEach(item => {
        articles.push({
          source: feed.name,
          title: cleanText(item.title),
          description: cleanText(item.contentSnippet || ""),
          link: item.link,
          pubDate: item.pubDate || "",
        });
      });
    } catch {}
  }

  res.json({ status: "success", articles });
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ API running → http://localhost:${PORT}`);
});
