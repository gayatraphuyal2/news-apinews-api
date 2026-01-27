// =======================
// Safe RSS-to-JSON API for news apps
// With OneSignal Real Push Notifications
// AUTO KEYWORD BASED NOTIFICATION (CRON)
// Fully fixed (NO DUPLICATE)
// =======================

require("dotenv").config();
const cron = require("node-cron");
const express = require("express");
const Parser = require("rss-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const OneSignal = require("onesignal-node");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

console.log("PID:", process.pid);

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

// ================= FEEDS =================
const FEEDS = [
  { name: "Baahrakhari", url: "https://baahrakhari.com/feed", profile: "" },
  { name: "OnlineKhabar", url: "https://www.onlinekhabar.com/feed", profile: "https://www.ashesh.org/app/news/logo/onlinekhabar.jpg" },
  { name: "Ratopati", url: "https://www.ratopati.com/feed", profile: "" },
  { name: "Setopati", url: "https://www.setopati.com/feed", profile: "https://www.ashesh.org/app/news/logo/setopati.jpg" },
  { name: "ThahaKhabar", url: "https://www.thahakhabar.com/feed", profile: "" },
  { name: "NepalSamaya", url: "https://nepalsamaya.com/feed", profile: "" },
  { name: "Rajdhani", url: "https://rajdhanidaily.com/feed", profile: "" },
  { name: "NewsOfNepal", url: "https://newsofnepal.com/feed", profile: "" },
  { name: "BizMandu", url: "https://bizmandu.com/feed", profile: "https://www.ashesh.org/app/news/logo/bizmandu.jpg" },
  { name: "Techpana", url: "https://techpana.com/feed", profile: "https://www.ashesh.org/app/news/logo/techpana.jpg" },
  { name: "Artha Dabali", url: "https://www.arthadabali.com/feed", profile: "https://www.arthadabali.com/wp-content/uploads/2020/01/logo.png" },
  { name: "Makalu Khabar", url: "https://www.makalukhabar.com/feed", profile: "https://www.makalukhabar.com/wp-content/uploads/2021/03/logo.png" },
  { name: "SwasthyaKhabar", url: "https://www.swasthyakhabar.com/feed", profile: "" },
  { name: "Nagarik News", url: "https://nagariknews.nagariknetwork.com/feed", profile: "https://staticcdn.nagariknetwork.com/images/default-image.png" },
  { name: "BBC Nepali", url: "https://www.bbc.com/nepali/index.xml", profile: "https://news.bbcimg.co.uk/nol/shared/img/bbc_news_120x60.gif" },
];

// ================= HELPERS =================
function cleanText(text = "") {
  return text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function cleanPubDate(pubDate = "") {
  return pubDate.replace(/[\n\r\t]/g, " ").trim();
}

// 🔒 STABLE ARTICLE ID (FIX)
function getArticleId(article) {
  return crypto
    .createHash("md5")
    .update((article.title + article.pubDate).toLowerCase())
    .digest("hex");
}

// ================= IMAGE SCRAPER =================
async function fetchOgImage(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 6000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    const $ = cheerio.load(data);
    return (
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      ""
    );
  } catch {
    return "";
  }
}

// ================= CACHE =================
let CACHE = { data: null, time: 0 };
const CACHE_DURATION = 30 * 60 * 1000;

// ================= KEYWORDS =================
const HIGH_KEYWORDS = [
  "भूकम्प","बाढी","पहिरो","हिमपात","आगलागी",
  "दुर्घटना","मृत्यु","आपतकालीन","विस्फोट",
  "प्रधानमन्त्री","पक्राउ","गणतन्त्र",
  "नरसंहार","आदेश","बेपत्ता","राशिफल",
];

// ================= NOTIFIED (PERSISTENT) =================
const NOTIFIED_FILE = path.join(__dirname, "notified.json");
let NOTIFIED_IDS = new Set();

try {
  const data = fs.readFileSync(NOTIFIED_FILE, "utf8");
  NOTIFIED_IDS = new Set(JSON.parse(data));
  console.log("🔄 Loaded notified:", NOTIFIED_IDS.size);
} catch {}

function saveNotified() {
  fs.writeFileSync(NOTIFIED_FILE, JSON.stringify([...NOTIFIED_IDS]));
}

// ================= NOTIFICATION STATE =================
let LAST_NOTIFICATION_TIME = 0;
const NOTIFY_COOLDOWN = 10 * 60 * 1000;

// ================= SCORE LOGIC =================
function getNewsScore(article) {
  let score = 0;
  const text = `${article.title} ${article.description}`;
  HIGH_KEYWORDS.forEach((k) => {
    if (text.includes(k)) score += 5;
  });
  return score;
}

// ================= SEND PUSH =================
async function sendPushNotification({ title, body, url }) {
  try {
    await oneSignalClient.createNotification({
      app_id: process.env.ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: body || "ताजा समाचार" },
      included_segments: ["All"],
      url,
    });
  } catch (err) {
    console.error("❌ OneSignal ERROR:", err.body || err);
  }
}

// ================= PROCESS NOTIFICATIONS =================
async function processNotifications(articles) {
  const now = Date.now();

  const important = articles
    .map((a) => ({
      ...a,
      id: getArticleId(a),
      score: getNewsScore(a),
    }))
    .filter(
      (a) =>
        a.score >= 5 &&
        !NOTIFIED_IDS.has(a.id)
    );

  if (!important.length) return;
  if (now - LAST_NOTIFICATION_TIME < NOTIFY_COOLDOWN) return;

  const top = important.sort((a, b) => b.score - a.score)[0];

  await sendPushNotification({
    title: top.title,
    body: top.description,
    url: top.link,
  });

  // ✅ ONLY MARK SENT ONE
  NOTIFIED_IDS.add(top.id);
  saveNotified();

  LAST_NOTIFICATION_TIME = now;
}

// ================= HEAVY FETCH =================
async function fetchAllFeeds() {
  let articles = [];

  await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const feedData = await parser.parseURL(feed.url);
        const items = feedData.items.slice(0, 10);

        for (const item of items) {
          let image =
            item.enclosure?.url ||
            item["media:content"]?.url ||
            "";

          if (!image && item.link) {
            image = await fetchOgImage(item.link);
          }

          articles.push({
            source: feed.name,
            title: cleanText(item.title),
            description: cleanText(item.contentSnippet || ""),
            link: item.link,
            image: image || feed.profile || "",
            pubDate: cleanPubDate(item.pubDate),
            profile: feed.profile,
          });
        }
      } catch {}
    })
  );

  articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
  return articles;
}

// ================= LIGHT FETCH =================
async function fetchFeedsForCron() {
  let articles = [];

  await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const feedData = await parser.parseURL(feed.url);
        const items = feedData.items.slice(0, 5);

        for (const item of items) {
          articles.push({
            title: cleanText(item.title),
            description: cleanText(item.contentSnippet || ""),
            link: item.link,
            pubDate: cleanPubDate(item.pubDate),
          });
        }
      } catch {}
    })
  );

  return articles;
}

// ================= CRON =================
const RUN_CRON = !process.env.pm_id || process.env.pm_id === "0";

if (RUN_CRON) {
  cron.schedule("*/5 * * * *", async () => {
    console.log("⏰ CRON: Checking RSS updates...");
    const articles = await fetchFeedsForCron();
    await processNotifications(articles);
  });
}

// ================= ROUTE =================
app.get("/news", async (req, res) => {
  if (CACHE.data && Date.now() - CACHE.time < CACHE_DURATION) {
    return res.json({
      status: "success",
      cached: true,
      total: CACHE.data.length,
      articles: CACHE.data,
    });
  }

  const articles = await fetchAllFeeds();
  CACHE.data = articles;
  CACHE.time = Date.now();

  res.json({
    status: "success",
    cached: false,
    total: articles.length,
    articles,
  });
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ API running → http://localhost:${PORT}/news`)
);
