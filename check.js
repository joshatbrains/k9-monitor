const https = require("https");
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "known-dogs.json");
const K9_URL = "https://cci.colorado.gov/K9";
const BASE_URL = "https://cci.colorado.gov";

const EMAIL_FROM = process.env.EMAIL_FROM;
const EMAIL_PASS = process.env.EMAIL_PASS;
const SMS_ADDRESS = process.env.SMS_ADDRESS;

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Accept-Encoding": "identity",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
      },
    };
    https.get(url, options, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log(`Fetched ${data.length} bytes, status ${res.statusCode}`);
        resolve(data);
      });
    }).on("error", reject);
  });
}

function parseDogs(html) {
  const dogs = [];

  // Try multiple patterns to find dog entries
  // Pattern 1: image alt + nearby heading link
  const blocks = html.split(/(?=<img[^>]+alt="[^"]*CI-\d+)/);
  
  for (const block of blocks) {
    const imgAlt = block.match(/<img[^>]+alt="([^"]*CI-\d+[^"]*)"/);
    const link = block.match(/<a[^>]+href="(\/contacts\/[^"]+)"[^>]*>([^<]+)<\/a>/);
    
    if (imgAlt && link) {
      const name = link[2].trim();
      const url = BASE_URL + link[1];
      const ciMatch = (imgAlt[1] + name).match(/CI-(\d+)/);
      if (ciMatch) {
        dogs.push({
          id: ciMatch[1],
          name,
          url,
          isAdopted: name.toLowerCase().includes("adopt"),
        });
      }
    }
  }

  // Pattern 2: fallback — just find all /contacts/ links with CI numbers
  if (dogs.length === 0) {
    console.log("Pattern 1 failed, trying pattern 2...");
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

  const html = await fetchPage(K9_URL);
  
  // Debug: print a snippet to see what we're getting
  console.log("HTML snippet:", html.substring(0, 500));
  
  const currentDogs = parseDogs(html);
  console.log(`Found ${currentDogs.length} dogs on page.`);

  if (currentDogs.length === 0) {
    console.log("No dogs parsed — dumping more HTML for debugging:");
    console.log(html.substring(500, 2000));
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
