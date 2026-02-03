# Quick Deployment Guide - Render

**Estimated Time**: 10 minutes  
**Cost**: Free tier available, $7+/month for production

---

## Step 1: Prepare GitHub Repository

✅ Already done! Your code is on GitHub at: https://github.com/Hamis254/payme

Ensure your `.env.example` is committed (sensitive values NOT in git).

---

## Step 2: Create Render Account

1. Go to https://render.com
2. Click "Get Started"
3. Sign in with GitHub
4. Authorize Render to access your repositories

---

## Step 3: Create PostgreSQL Database

1. In Render dashboard, click "New +"
2. Select "PostgreSQL"
3. Configure:
   - **Name**: `payme-postgres`
   - **Database**: `payme_prod`
   - **User**: `payme_user`
   - **Region**: Choose closest to your users
   - **Version**: PostgreSQL 15
   - **Plan**: Standard (production-grade)
4. Click "Create Database"
5. Wait for database to be ready (~5 minutes)
6. Copy the connection string - you'll need it

---

## Step 4: Create Web Service

1. Click "New +"
2. Select "Web Service"
3. Connect GitHub:
   - Select your `payme` repository
   - Click "Connect"

4. Configure Web Service:
   ```
   Name: payme-api
   Environment: Node
   Build Command: npm ci && npm run db:migrate
   Start Command: npm start
   Plan: Standard ($7+/month)
   Region: Same as database
   ```

5. Click "Create Web Service"

---

## Step 5: Add Environment Variables

While Web Service is building, add environment variables:

1. In Service Settings → Environment
2. Add the following (get values from your `.env` file):

```
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

DATABASE_URL=[paste from PostgreSQL connection string]

JWT_SECRET=[generate: openssl rand -hex 32]
JWT_EXPIRY=7d

ARCJET_KEY=[your-arcjet-key]

MPESA_ENV=production
MPESA_CONSUMER_KEY=[your-key]
MPESA_CONSUMER_SECRET=[your-secret]
MPESA_SHORTCODE_PAYBILL=[your-code]
MPESA_PASSKEY_PAYBILL=[your-passkey]
MPESA_CALLBACK_URL=https://payme-api-xxxxx.onrender.com/api/mpesa/callback

[... add all other required variables ...]
```

3. Save environment variables

---

## Step 6: Configure Custom Domain (Optional)

1. In Web Service → Settings → Custom Domain
2. Add your domain: `api.payme.app`
3. Render provides free SSL certificate
4. Update DNS records with CNAME provided by Render

---

## Step 7: Verify Deployment

1. Wait for build to complete (check logs)
2. Once "Live" status appears, test health endpoint:
   ```bash
   curl https://payme-api-xxxxx.onrender.com/health
   ```
   Should return:
   ```json
   {
     "status": "ok",
     "database": "connected",
     "uptime": 123
   }
   ```

3. If failed, check deployment logs:
   - Render Dashboard → Services → payme-api → Logs
   - Common issues:
     - Database URL incorrect
     - Missing environment variables
     - Migration failed

---

## Step 8: Set Up Auto-Deploys

1. In Web Service → Settings
2. Enable "Auto-Deploy" 
3. Select "Yes" for "Deploy on every push to main branch"
4. Now every git push to main auto-deploys! 🚀

---

## Step 9: Configure GitHub Actions (Optional)

For CI/CD with automated testing before deployment:

1. In GitHub repository → Settings → Secrets and variables
2. Add secrets:
   ```
   RENDER_SERVICE_ID=srv-xxxxxxxxxxxxx
   RENDER_API_KEY=[get from Render dashboard]
   ```

3. GitHub Actions workflows in `.github/workflows/` will now run automatically

---

## Step 10: Monitor and Alert

1. In Render dashboard → Services → payme-api → Settings
2. Enable notifications for:
   - Deployment started
   - Deployment completed
   - Deployment failed
3. Add email or webhook for alerts

---

## Scaling & Performance

### As User Base Grows

1. **More Database Connections**:
   - Render PostgreSQL → Settings → Connection Pool
   - Increase pool size to 30-50

2. **Multiple API Instances**:
   - Render automatically load balances
   - Upgrade to "Standard Plus" plan for guaranteed resources

3. **Redis Cache**:
   - Add Redis service in Render
   - Update `REDIS_URL` environment variable
   - Caches session data and frequently accessed data

4. **CDN**:
   - For static assets, use Cloudflare (free tier)
   - Set CNAME to Render service
   - Reduces load on API server

---

## Monitoring Dashboard

Set up free monitoring at:

1. **Uptime Robot** (https://uptimerobot.com):
   - Monitor: `https://payme-api-xxxxx.onrender.com/health`
   - Interval: Every 5 minutes
   - Alert: Email on downtime

2. **Sentry** (https://sentry.io):
   - Add `SENTRY_DSN` to environment variables
   - Get real-time error notifications

3. **Datadog** (https://www.datadoghq.com):
   - Free tier available
   - Full application monitoring

---

## Database Backups

Render PostgreSQL includes automatic daily backups:

1. In PostgreSQL service → Backups
2. View backup history
3. Can restore to point-in-time if needed

**Note**: For production critical data, also set up:
```bash
# Weekly backup to S3
0 2 * * 0 pg_dump $DATABASE_URL | gzip | aws s3 cp - s3://payme-backups/$(date +%Y%m%d).sql.gz
```

---

## Deployment Complete! ✅

Your PayMe API is now live on:
- **URL**: https://payme-api-xxxxx.onrender.com
- **Health**: https://payme-api-xxxxx.onrender.com/health
- **Custom Domain**: https://api.payme.app (if configured)

### Next Steps:

1. ✅ Connect mobile app to: `https://your-api-domain.com`
2. ✅ Test a sale: `POST /api/sales`
3. ✅ Verify M-Pesa callback handling
4. ✅ Set up monitoring & alerts
5. ✅ Train support team on operations

---

## Troubleshooting

### Build Fails

1. Check build logs in Render
2. Common issues:
   - `npm ci` fails → Check package.json
   - `npm run db:migrate` fails → Check DATABASE_URL
   - Missing environment variables → Add to Render

### App Crashes After Deploy

1. Check runtime logs in Render
2. Common causes:
   - Database connection error
   - Out of memory (scale up plan)
   - Uncaught exception

### Database Connection Errors

1. Verify `DATABASE_URL` is correct
2. Check if database is running
3. Ensure firewall allows connections from Render

---

## Performance Tips

1. **Database Optimization**:
   ```sql
   -- Run these after first deployment
   VACUUM ANALYZE;
   CREATE INDEX idx_business_id ON sales(business_id);
   CREATE INDEX idx_user_id ON businesses(user_id);
   CREATE INDEX idx_status ON walletTransactions(status);
   ```

2. **API Performance**:
   - Response time target: <200ms
   - Error rate: <0.5%
   - Check Render analytics

3. **Memory Management**:
   - Monitor in Render → Services → Metrics
   - If consistently >80%, upgrade plan

---

## Support

- **Render Docs**: https://render.com/docs
- **PayMe API Docs**: See DOCUMENTATION_INDEX.md
- **GitHub Issues**: Report bugs
- **Email**: Support contact information

---

## Cost Summary (Monthly)

| Component | Free | Paid |
|-----------|------|------|
| PostgreSQL Database | No | $15+ |
| Web Service | $7.99 min | $7+ |
| Redis Cache | $2.50+ | $2.50+ |
| **Total** | **$0** | **$25+** |

For testing/staging, Render's free tier database is perfect. Upgrade to paid when going live with real merchants.
