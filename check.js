const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const STATE_FILE = path.join(__dirname, "known-dogs.json");
const K9_URL = "https://cci.colorado.gov/K9";
const BASE_URL = "https://cci.colorado.gov";

const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_PASS = process.env.EMAIL_PASS;
const SMS_ADDRESS = process.env.SMS_ADDRESS;

async function fetchPage() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(K9_URL, { waitUntil: "networkidle" });
  const html = await page.content();
  await browser.close();
  return html;
}

function parseDogs(html) {
  const dogs = [];
  const linkRegex = /<a[^>]+href="(\/contacts\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const name = match[2].trim();
    const ciMatch = name.match(/CI-(\d+)/);
    if (ciMatch) {
      dogs.push({
        id: ciMatch[1],
        name,
        url: BASE_URL + match[1],
        isAdopted: name.toLowerCase().includes("adopt"),
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

async function sendSMS(subject, body) {
  const nodemailer = require("nodemailer");
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: { user: EMAIL_FROM, pass: EMAIL_PASS },
  });
  return transporter.sendMail({
    from: EMAIL_FROM,
    to: SMS_ADDRESS,
    subject,
    text: body,
  });
}

async function main() {
  console.log(`[${new Date().toISOString()}] Checking CCI K9 page...`);

  const html = await fetchPage();
  console.log(`Fetched ${html.length} bytes`);

  const currentDogs = parseDogs(html);
  console.log(`Found ${currentDogs.length} dogs on page.`);

  if (currentDogs.length === 0) {
    console.log("No dogs parsed — page structure may have changed.");
    console.log(html.substring(0, 2000));
    return;
  }

  const knownDogs = loadKnownDogs();

  if (knownDogs === null) {
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
      const cleanName = dog.name.replace(/\s*CI-\d+/, "").replace(/\*+[^*]+\*+/g, "").trim();
      const body = `New dog available: ${cleanName} (CI-${dog.id})\n${dog.url}`;
      await sendSMS(`New CCI K9: ${cleanName}`, body);
      console.log(`Alert sent for ${cleanName}`);
    }
  }

  saveKnownDogs(currentDogs);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
