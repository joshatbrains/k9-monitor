const https = require("https");
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "known-dogs.json");
const K9_URL = "https://cci.colorado.gov/K9";
const BASE_URL = "https://cci.colorado.gov";

// Email-to-SMS config (set these as GitHub Secrets)
const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 587;
const EMAIL_FROM = process.env.EMAIL_FROM;       // your Gmail address
const EMAIL_PASS = process.env.EMAIL_PASS;       // Gmail App Password
const SMS_ADDRESS = process.env.SMS_ADDRESS;     // e.g. 7208387251@txt.att.net

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
}

function parseDogs(html) {
  const dogs = [];
  const regex = /<img[^>]+src="([^"]+)"[^>]*alt="([^"]+)"[\s\S]*?<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const imgSrc = match[1];
    const name = match[4].trim();
    const url = match[3];
    const ciMatch = name.match(/CI-(\d+)/);
    if (ciMatch) {
      const fullUrl = url.startsWith("http") ? url : BASE_URL + url;
      const isAdopted = name.toLowerCase().includes("adopt");
      dogs.push({
        id: ciMatch[1],
        name,
        url: fullUrl,
        isAdopted,
      });
    }
  }
  return dogs;
}

function loadKnownDogs() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveKnownDogs(dogs) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(dogs, null, 2));
}

function sendSMS(subject, body) {
  return new Promise((resolve, reject) => {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: {
        user: EMAIL_FROM,
        pass: EMAIL_PASS,
      },
    });

    transporter.sendMail({
      from: EMAIL_FROM,
      to: SMS_ADDRESS,
      subject,
      text: body,
    }, (err, info) => {
      if (err) reject(err);
      else resolve(info);
    });
  });
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking CCI K9 page...`);

  const html = await fetchPage(K9_URL);
  const currentDogs = parseDogs(html);

  if (currentDogs.length === 0) {
    console.log("No dogs parsed — page structure may have changed.");
    return;
  }

  console.log(`Found ${currentDogs.length} dogs on page.`);

  const knownDogs = loadKnownDogs();

  if (knownDogs === null) {
    // First run — save baseline, no alert
    saveKnownDogs(currentDogs);
    console.log(`First run: saved ${currentDogs.length} dogs as baseline. No alert sent.`);
    return;
  }

  const knownIds = new Set(knownDogs.map((d) => d.id));
  const newDogs = currentDogs.filter((d) => !knownIds.has(d.id) && !d.isAdopted);

  if (newDogs.length === 0) {
    console.log("No new dogs found. Nothing sent.");
  } else {
    console.log(`${newDogs.length} new dog(s) found! Sending alert...`);

    for (const dog of newDogs) {
      const cleanName = dog.name
        .replace(/\s*CI-\d+/, "")
        .replace(/\*+[^*]+\*+/g, "")
        .trim();

      const body = `New dog available: ${cleanName} (CI-${dog.id})\n${dog.url}`;

      await sendSMS(`New CCI K9: ${cleanName}`, body);
      console.log(`Alert sent for ${cleanName}`);
    }

    // Update known list to include all current dogs
    saveKnownDogs(currentDogs);
  }

  // Always update state with current list so adopted dogs don't re-trigger
  saveKnownDogs(currentDogs);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
