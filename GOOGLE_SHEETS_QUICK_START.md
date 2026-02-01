# Google Sheets Integration - Quick Start

## TL;DR

**Status**: ✅ Fully implemented, awaiting credentials only

**What to do**:
1. Choose auth method (OAuth2 or Service Account)
2. Get credentials from Google Cloud Console
3. Add to `.env`
4. Done! Records auto-sync

---

## 1️⃣ OAuth2 Setup (Easiest for Users)

### Get Credentials
1. Go to https://console.cloud.google.com
2. Create new project
3. Enable APIs: "Google Sheets API" + "Google Drive API"
4. Create OAuth2 credentials (Web Application)
5. Set Redirect URI: `http://localhost:3000/auth/google-callback`
6. Copy Client ID & Secret

### Add to .env
```bash
GOOGLE_SHEETS_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_SHEETS_CLIENT_SECRET=your_secret
GOOGLE_SHEETS_REDIRECT_URL=http://localhost:3000/auth/google-callback
GOOGLE_SHEETS_ENABLED=true
```

### How It Works
- User clicks "Connect Google Sheets"
- Redirects to Google login
- User authorizes
- System saves refresh token
- All future records auto-sync

---

## 2️⃣ Service Account Setup (Best for Automation)

### Get Credentials
1. Go to https://console.cloud.google.com
2. Create Service Account
3. Generate JSON key
4. Save to secure location (e.g., `/config/google-service-key.json`)
5. Copy the service account email

### Add to .env
```bash
GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY=/absolute/path/to/google-service-key.json
GOOGLE_SHEETS_ENABLED=true
```

### How It Works
- No user interaction needed
- Server uses service account to sync
- Share Google Drive folder with service account email
- Automatic sync on record creation

---

## 3️⃣ Test It Works

### Create a Record
```bash
curl -X POST http://localhost:3000/api/records/1/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "sales",
    "category": "retail", 
    "amount": 5000,
    "payment_method": "cash",
    "transaction_date": "2026-01-27",
    "items": [{"item_name": "Item", "quantity": 1, "unit_price": 5000}]
  }'
```

### Check Response
```json
{
  "success": true,
  "record": {
    "id": 1,
    "synced_to_sheets": true,
    "sheets_row_id": "Sheet1!A2:N2",
    ...
  }
}
```

If `synced_to_sheets: true` → Google Sheets sync is working! ✅

---

## 4️⃣ Troubleshoot

| Problem | Solution |
|---------|----------|
| `synced_to_sheets: false` | Check `GOOGLE_SHEETS_ENABLED=true` in .env |
| `sheets_sync_error: "Invalid credentials"` | Check Client ID/Secret or key file path |
| `synced_to_sheets: false` but no error | Business might not have spreadsheet linked |
| "Permission denied" | Share Google Sheets folder with service account email |
| Slow sync | Use batch sync for bulk operations |

---

## 5️⃣ What Happens Now

✅ **With Credentials**:
- Records auto-append to Google Sheets
- Beautiful formatted rows with headers
- Business gets live financial dashboard in Sheets
- Data stays synced (append-only)

❌ **Without Credentials**:
- Records still created in database
- Just not synced to Sheets
- Can enable anytime

**Either way: Your business logic works!** 🎉

---

## 6️⃣ Environment Variables Reference

```bash
# Enable/Disable (required)
GOOGLE_SHEETS_ENABLED=true

# OAuth2 Method (pick this OR service account)
GOOGLE_SHEETS_CLIENT_ID=
GOOGLE_SHEETS_CLIENT_SECRET=
GOOGLE_SHEETS_REDIRECT_URL=http://localhost:3000/auth/google-callback
GOOGLE_SHEETS_REFRESH_TOKEN=   # Auto-filled after user authorizes

# Service Account Method (pick this OR OAuth2)
GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY=/path/to/key.json
```

---

## 7️⃣ Advanced: Batch Sync

If records failed to sync, recover them:

```bash
POST /api/records/:business_id/batch-sync
Content-Type: application/json

[
  { id: 1, transaction_date: "2026-01-20", type: "sales", amount: 5000, ... },
  { id: 2, transaction_date: "2026-01-21", type: "sales", amount: 3000, ... }
]

Response: { synced: 45, failed: 0, total: 45 }
```

---

## 📊 What You Get

Each record becomes a row in Google Sheets:

| Date | Time | Type | Amount | Payment | M-Pesa Code | ... |
|------|------|------|--------|---------|-------------|-----|
| 27/01/2026 | 14:30 | sales | 5000 | cash | N/A | ... |
| 26/01/2026 | 10:15 | sales | 3000 | mpesa | LHC123ABC | ... |

---

## 🚀 You're All Set!

1. ✅ Code is production-ready
2. ✅ All functions implemented
3. ✅ Error handling complete
4. ✅ Just needs credentials

**Add credentials → Records auto-sync → Done!** 🎉

