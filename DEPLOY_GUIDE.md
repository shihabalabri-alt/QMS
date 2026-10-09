# QMS Website — Quick Publish Guide (for family)

## Overview
This guide publishes the **React frontend** to Vercel (free, 5 minutes). The Node.js API server runs separately. 

The published site will show the UI (dashboards, pages, navigation). API calls will connect to your local server at `http://localhost:4000`, or you can host the API separately later.

---

## Step 1: Install Vercel CLI (once)

```powershell
npm install -g vercel
```

---

## Step 2: Deploy the frontend

From the `qms` folder:

```powershell
vercel
```

You'll be asked:
- "Link to existing project?" → `N` (No)
- "Select your framework?" → `Vite` (or just press Enter)
- "Deploy?" → `Y`

After a few seconds, Vercel will give you a URL like:
`https://qms-xxxx.vercel.app`

**Share this URL with your family.** They can type it in any browser.

---

## Step 3: (Optional) Custom domain

In the Vercel dashboard, add your domain (e.g., `qms.yourname.com`) and enable HTTPS/lock icon.

---

## Step 4: API notes

The published site will try to reach `http://localhost:4000` for API calls. This means:

- **If your dad is on the same home network**: The API will work when your local server (`node index.js`) is running.
- **If accessed from elsewhere**: API calls will fail with "server died" or connection errors (the local server only runs on your machine).
- **For full functionality**: Host the Node.js API separately (Heroku, Render, VPS) or deploy a cloud database.

---

## Step 5: Skip API — static UI only

If you just want the UI to work for your family without the API:

1. Deploy to Vercel as above
2. Edit `client/src/lib/api.js` and change the base URL:
   ```js
   // Change from:
   // const res = await fetch(`/api${path}`, ...)
   // To:
   // const res = await fetch(`https://your-vercel-url.vercel.app/api${path}`, ...)
   ```
   This makes the frontend talk to the deployed frontend (no API needed for UI-only views).

---

## What your family will see

- All 15 module pages (Dashboard, Documents, Risks, Policies, etc.)
- Navigation, search, filters, tables
- Create/edit forms (will show "server died" if API not connected)
- Reports page with dashboards
- History, comments, global search

**They will NOT see** live data from the API unless you also host the backend. But they CAN navigate the UI, see the design, and understand the QMS structure.

---

## If you want BOTH frontend + API online (more work)

1. **Frontend**: Deploy to Vercel as above
2. **Backend**: Sign up for [Render.com](https://render.com) (free) or [Heroku](https://heroku.com) (free tier)
3. Move `server/index.js` to the cloud host
4. Update the API URL in `client/src/lib/api.js` to the new domain
5. Migrate `server/data/qms.db` to a cloud database (PostgreSQL/MySQL) — or use the cloud host's built-in DB

This takes ~30 minutes with a guided tutorial. The Vercel-only option (Step 2) is the fastest way to show your family something today.

---

## Need help?

- stuck on `vercel` command? → Ensure Node.js is added to PATH, then retry
- API errors after deploy? → That's expected; the UI still loads, just the data calls fail
- Want to connect a domain? → In Vercel dashboard → Add Domain → Follow DNS steps

---

**Done.** Share the Vercel URL with your family. The site is now publicly accessible (UI only). 

--
*Full bugs fixed: 7 missing-import crashes resolved | New: CSV export on Reports page | Server: localhost:4000 (runs when you start it)*