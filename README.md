# CCI K9 Monitor

Automatically checks the [CCI Prison Trained K9 Companion Program](https://cci.colorado.gov/K9) every 30 minutes and sends a text message when a new dog is added.

## Setup

### 1. Create a new GitHub repo and push these files

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/YOUR_USERNAME/k9-monitor.git
git push -u origin main
```

### 2. Set up a Gmail App Password

The script sends email to your AT&T SMS gateway using Gmail as the sender.

1. Go to your Google Account → **Security**
2. Make sure **2-Step Verification** is enabled
3. Search for **App Passwords** → create one → name it "k9-monitor"
4. Copy the 16-character password

### 3. Add GitHub Secrets

In your repo go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name   | Value                                      |
|---------------|--------------------------------------------|
| `EMAIL_FROM`  | Your Gmail address (e.g. you@gmail.com)    |
| `EMAIL_PASS`  | The 16-char App Password from step 2       |
| `SMS_ADDRESS` | `7208387251@txt.att.net`                   |

### 4. Enable GitHub Actions

Go to the **Actions** tab in your repo and enable workflows if prompted.

### 5. First run

Trigger a manual run: **Actions → CCI K9 Monitor → Run workflow**

This first run sets the baseline (saves current dogs to `known-dogs.json`) without sending any alert. Every run after that will text you if something new shows up.

## How it works

- GitHub Actions runs the script on a cron schedule every 30 minutes
- The script scrapes `cci.colorado.gov/K9` and compares against `known-dogs.json`
- New dogs (not previously seen, not already adopted) trigger a text per dog:
  ```
  New dog available: Boomer (CI-5419)
  https://cci.colorado.gov/contacts/boomer-ci-5419
  ```
- The updated dog list is committed back to the repo automatically

## Cost

Free. GitHub Actions gives 2,000 minutes/month on free accounts. At 30-minute intervals that's ~1,440 runs/month, each taking under 30 seconds ≈ ~720 minutes used.
