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
  { name: "Baahrakhari", url: "https://baahrakhari.com/feed", profile: "https://baahrakhari.com/themes/baahrakhari/images/logo.png" },
  { name: "OnlineKhabar", url: "https://www.onlinekhabar.com/feed", profile: "https://www.onlinekhabar.com/wp-content/themes/onlinekhabar-2021/img/ok-icon.png" },
  { name: "Ratopati", url: "https://www.ratopati.com/feed", profile: "https://www.ashesh.org/app/news/logo/ratopati.jpg" },
  { name: "Setopati", url: "https://www.setopati.com/feed", profile: "https://www.ashesh.org/app/news/logo/setopati.jpg" },
  { name: "ThahaKhabar", url: "https://www.thahakhabar.com/feed", profile: "https://www.thahakhabar.com/uploads/authors/Logo_Thaha.jpg" },
  { name: "NepalSamaya", url: "https://nepalsamaya.com/feed", profile: "https://nepalsamaya.com/uploads/authors/96208500.png" },
  { name: "Rajdhani", url: "https://rajdhanidaily.com/feed", profile: "https://rajdhanidaily.com/wp-content/uploads/2021/10/web-logo-resized.jpg" },
  { name: "NewsOfNepal", url: "https://newsofnepal.com/feed", profile: "https://newsofnepal.com/wp-content/themes/newsofnepalnaya/img/namaste-kamana.jpg" },
  { name: "BizMandu", url: "https://bizmandu.com/feed", profile: "https://www.ashesh.org/app/news/logo/bizmandu.jpg" },
  { name: "Techpana", url: "https://techpana.com/feed", profile: "https://www.ashesh.org/app/news/logo/techpana.jpg" },
  { name: "Artha Dabali", url: "https://www.arthadabali.com/feed", profile: "https://www.arthadabali.com/users_upload/1603365124-j5Ga9-image_2020-10-22_165655.png" },
  { name: "Makalu Khabar", url: "https://www.makalukhabar.com/feed", profile: "https://www.makalukhabar.com/wp-content/uploads/2023/10/Final-icon-Logo-2023.png" },
  { name: "SwasthyaKhabar", url: "https://swasthyakhabar.com/feed", profile: "https://swasthyakhabar.com/uploads/authors/37126900.jpg" },
  { name: "Nagarik News", url: "https://nagariknews.nagariknetwork.com/feed", profile: "https://images.nagariknewscdn.com/thumbs/authors/nagarik-150x150.jpg" },
  { name: "BBC Nepali", url: "https://www.bbc.com/nepali/index.xml", profile: "https://www.ashesh.org/app/news/logo/bbcnepali.jpg" },
];

const CATEGORIES = {
  business: ["अर्थ", "व्यापार", "बैंक", "उत्पादन", "सेयर", "शेयर", "निवेश", "आर्थिक"],
  health: ["स्वास्थ्य", "रोग", "चिकित्सा", "अस्पताल", "कोरोना", "अस्पताल","अस्पतालको", "खोप","दादुरा", "रक्तचाप", "मुटु","माइग्रेन","अल्जाइमर", "झाडापखाला", "कब्जियत","हेपाटाइटिस", "डेङ्गु", "टाइफाइड", "एड्स", "मधुमेह", "डिप्रेसन", "थाइराइड", "क्यान्सर"],
  politics: ["राजनीति", "सरकार", "चुनावको", "प्रधानमन्त्री", "मन्त्री", "संसद", "पार्टी","फोरम", "दल","काँग्रेस","जनमोर्चा", "एमाले", "माओवादी", "रास्वपा", "राप्रपा", "जसपा", "लोसपा", "चुनाव","निर्वाचन"],
  accident: ["दुर्घटना", "मृत्यु", "बेपत्ता", "घाइते", "हत्या", "आगो", "विस्फोट", "accident", "death", "killed", "injured", "fire"],
  sports: ["खेल", "क्रिकेट", "फुटबल", "गोल"],
  technology: ["प्रविधि", "टेक", "मोबाइल", "इन्टरनेट", "एआई", "कम्प्युटर", "लापटप", "डेटा", "नेटवर्क", "भर्चुअल", "मेसिन"],
};

function detectCategory(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    for (const k of keywords) {
      if (text.includes(k.toLowerCase())) {
        return category;
      }
    }
  }
  return "general";
}


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
async function sendPushNotification({ title, body, url, image }) {
  await oneSignalClient.createNotification({
    app_id: process.env.ONESIGNAL_APP_ID,

    headings: { en: title },
    contents: { en: body || "ताजा समाचार" },

    included_segments: ["All"],
    android_channel_id: "0ddaab0b-2b3a-45fc-b40e-91bf9c4f7a98",
    // 👇 BIG IMAGE
    big_picture: image || undefined, // ANDROID
    ios_attachments: image
      ? { newsImage: image }
      : undefined,

    data: {
      click_action: "OPEN_NEWS",
      url,
      title,
    },
  });
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
    image: top.image, // 🖼️ NEWS IMAGE
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
            category: detectCategory(item.title, item.contentSnippet),
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
            category: detectCategory(item.title, item.contentSnippet),
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
