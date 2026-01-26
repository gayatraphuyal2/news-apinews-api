// =======================
// Safe RSS-to-JSON API for news apps
// With OneSignal Real Push Notifications
// =======================

require("dotenv").config();

const express = require("express");
const Parser = require("rss-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const OneSignal = require("onesignal-node");

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
  { name: "SwasthyaKhabar", url: "https://swasthyakhabar.com/feed", profile: "" },
  { name: "Nagarik News", url: "https://nagariknews.nagariknetwork.com/feed", profile: "https://staticcdn.nagariknetwork.com/images/default-image.png" },
  { name: "BBC Nepali", url: "https://www.bbc.com/nepali/index.xml", profile: "https://news.bbcimg.co.uk/nol/shared/img/bbc_news_120x60.gif" },
];

// ================= HELPERS =================
function cleanText(text = "") {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanPubDate(pubDate = "") {
  return pubDate.replace(/[\n\r\t]/g, " ").trim();
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

// ================= NOTIFICATION KEYWORDS =================
const HIGH_KEYWORDS = [
  "भूकम्प",
  "बाढी",
  "पहिरो",
  "हिमपात",
  "आगलागी",
  "दुर्घटना",
  "मृत्यु",
  "आपतकालीन",
  "विस्फोट",
  "प्रधानमन्त्री",
  "पक्राउ",
  "गणतन्त्र ",
  "नरसंहार ",
  "आदेश",
  "बेपत्ता",
  "राशिफल",
];

// ================= NOTIFICATION STATE =================
let LAST_NOTIFICATION_TIME = 0;
const NOTIFY_COOLDOWN = 10 * 60 * 1000;
const NOTIFIED_LINKS = new Set();

// ================= SCORE (OLD LOGIC) =================
function getNewsScore(article) {
  let score = 0;
  const text = `${article.title} ${article.description}`;

  HIGH_KEYWORDS.forEach((k) => {
    if (text.includes(k)) {
      console.log("✅ KEYWORD MATCH:", k, "→", article.title);
      score += 5;
    }
  });

  return score;
}

// ================= SEND PUSH (FIXED LOG ONLY) =================
async function sendPushNotification({ title, body, url }) {
  try {
    const res = await oneSignalClient.createNotification({
      app_id: process.env.ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: body || "ताजा महत्वपूर्ण समाचार" },
      included_segments: ["All"],
      url,
    });

    const notifId = res?.id || res?.body?.id || "UNKNOWN";
    console.log("🔔 PUSH SENT:", notifId);
  } catch (err) {
    console.error("❌ OneSignal ERROR:", err.body || err);
  }
}

// ================= PROCESS NOTIFICATIONS =================
async function processNotifications(articles) {
  const now = Date.now();

  const important = articles
    .filter((a) => !NOTIFIED_LINKS.has(a.link))
    .map((a) => ({ ...a, score: getNewsScore(a) }))
    .filter((a) => a.score >= 5);

  console.log("🧠 Important news found:", important.length);

  if (!important.length) return;

  const isEmergency = important.some((a) =>
    [
      "दुर्घटना",
      "मृत्यु",
      "भूकम्प",
      "विस्फोट",
      "बाढी",
      "पहिरो",
      "हिमपात",
      "आगलागी",
      "आपतकालीन",
      "प्रधानमन्त्री",
      "पक्राउ",
      "गणतन्त्र",
      "नरसंहार",
      "आदेश",
      "बेपत्ता",
      "राशिफल",
    ].some((k) => a.title.includes(k))
  );

  if (!isEmergency && now - LAST_NOTIFICATION_TIME < NOTIFY_COOLDOWN) {
    console.log("⏳ Cooldown active, skip push");
    return;
  }

  const top = important.sort((a, b) => b.score - a.score)[0];

  await sendPushNotification({
    title: top.title,
    body: top.description,
    url: top.link,
  });

  important.forEach((n) => NOTIFIED_LINKS.add(n.link));
  LAST_NOTIFICATION_TIME = now;
}

// ================= ROUTE =================
app.get("/news", async (req, res) => {
  try {
    if (CACHE.data && Date.now() - CACHE.time < CACHE_DURATION) {
      console.log("📦 Serving from cache");
      return res.json({
        status: "success",
        cached: true,
        total: CACHE.data.length,
        articles: CACHE.data,
      });
    }

    let articles = [];

    await Promise.all(
      FEEDS.map(async (feed) => {
        try {
          const feedData = await parser.parseURL(feed.url);
          const items = feedData.items.slice(0, 10);

          const feedArticles = await Promise.all(
            items.map(async (item) => {
              let image =
                item.enclosure?.url ||
                item["media:content"]?.url ||
                "";

              if (!image && item.link) {
                image = await fetchOgImage(item.link);
              }

              return {
                source: feed.name,
                title: cleanText(item.title),
                description: cleanText(item.contentSnippet || ""),
                link: item.link,
                image: image || feed.profile || "",
                pubDate: cleanPubDate(item.pubDate),
                profile: feed.profile,
              };
            })
          );

          articles.push(...feedArticles);
        } catch {
          console.log(`❌ Feed failed: ${feed.name}`);
        }
      })
    );

    articles.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    processNotifications(articles).catch(console.error);

    CACHE.data = articles;
    CACHE.time = Date.now();

    res.json({
      status: "success",
      cached: false,
      total: articles.length,
      articles,
    });
  } catch {
    res.status(500).json({
      status: "error",
      message: "Failed to fetch news",
    });
  }
});

// ================= START =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`✅ API running → http://localhost:${PORT}/news`)
);
