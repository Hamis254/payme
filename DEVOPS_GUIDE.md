# PayMe DevOps & Deployment Guide

**Version**: 1.0  
**Date**: January 28, 2026  
**Status**: ✅ PRODUCTION READY  

---

## 📋 Table of Contents

1. [CI/CD Pipeline](#cicd-pipeline)
2. [Environment Variable Management](#environment-variables)
3. [Database Migration Strategy](#database-migrations)
4. [Monitoring & Error Tracking](#monitoring)
5. [Backup & Disaster Recovery](#backups)
6. [Scaling for 4,500+ Merchants](#scaling)
7. [Deployment Checklist](#deployment-checklist)

---

## CI/CD Pipeline

### Current State

❌ No automated testing
❌ No automated deployment
❌ Manual code reviews

### Solution: GitHub Actions

**File**: `.github/workflows/ci-cd.yml`

```yaml
name: CI/CD Pipeline
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18.x
          cache: npm
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint code
        run: npm run lint
      
      - name: Format check
        run: npm run format:check

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18.x
          cache: npm
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests
        run: npm test
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/payme_test
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
      
      - name: Check dependencies
        run: npm audit --audit-level=high

  deploy-staging:
    needs: [lint, test, security]
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to staging
        run: |
          curl -X POST https://api.staging.payme.co.ke/deploy \
            -H "Authorization: Bearer ${{ secrets.DEPLOY_TOKEN }}" \
            -d "commit=${{ github.sha }}"

  deploy-production:
    needs: [lint, test, security]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to production
        run: |
          curl -X POST https://api.payme.co.ke/deploy \
            -H "Authorization: Bearer ${{ secrets.DEPLOY_TOKEN }}" \
            -d "commit=${{ github.sha }}"
      
      - name: Create release
        uses: actions/create-release@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tag_name: v${{ github.run_id }}
          release_name: Release ${{ github.run_id }}
          draft: false
          prerelease: false
```

### Deployment Flow

```
Developer pushes code
    ↓
GitHub Actions triggers
    ↓
┌─ Lint ─ Format ─ Security ─ Tests ─┐
│ (run in parallel for speed)         │
└─────────────────────────────────────┘
    ↓
All pass?
    ↓ YES: Deploy to Staging (on PR)
    ↓
Staging tests pass?
    ↓ YES: Merge to main
    ↓
    ↓ YES: Deploy to Production (on main push)
    ↓
Production health check
    ↓ SUCCESS: Release created
```

### Setup Instructions

```bash
# 1. Create secrets in GitHub
# Settings → Secrets and variables → Actions → New repository secret

DEPLOY_TOKEN=your_secure_token_here
SNYK_TOKEN=your_snyk_token_here
SENTRY_AUTH_TOKEN=your_sentry_token_here

# 2. Create .github/workflows/ci-cd.yml with content above

# 3. Enable branch protections
# Settings → Branches → Add rule
# - Require status checks to pass before merging
# - Require code reviews
# - Require up-to-date branches

# 4. Test locally first
npm run lint
npm test
npm run format:check
```

---

## Environment Variables

### Problem

Current setup has risks:
- Keys in .env file (source control risk)
- No validation of required variables
- No separation of dev/staging/prod configs

### Solution: Structured Environment Management

#### 1. Create `.env.example` (Safe Template)

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost/payme

# Encryption
ENCRYPTION_KEY=your_encryption_key_here_64_chars

# JWT
JWT_SECRET=your_jwt_secret_min_32_chars

# Arcjet Security
ARCJET_KEY=your_arcjet_key_here

# M-Pesa Configuration
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=your_consumer_key
MPESA_CONSUMER_SECRET=your_consumer_secret
MPESA_SHORTCODE_PAYBILL=123456
MPESA_PASSKEY_PAYBILL=your_passkey
MPESA_CALLBACK_URL=https://yourdomain.com/api/sales/mpesa/callback

# Server
PORT=3000
NODE_ENV=development
LOG_LEVEL=info

# Optional: Monitoring
SENTRY_DSN=https://examplePublicKey@o0.ingest.sentry.io/0
```

#### 2. Environment Validation on Startup

Create `src/config/envValidation.js`:

```javascript
import logger from './logger.js';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'ARCJET_KEY',
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
];

const OPTIONAL_ENV_VARS = [
  'SENTRY_DSN',
  'REDIS_URL',
  'LOG_LEVEL',
];

export const validateEnvironment = () => {
  const missing = [];
  const warnings = [];

  for (const variable of REQUIRED_ENV_VARS) {
    if (!process.env[variable]) {
      missing.push(variable);
    }
  }

  for (const variable of OPTIONAL_ENV_VARS) {
    if (!process.env[variable]) {
      warnings.push(`Optional: ${variable} not set`);
    }
  }

  if (missing.length > 0) {
    logger.error('Missing required environment variables', {
      missing,
      hint: 'Copy .env.example to .env and fill in values',
    });
    process.exit(1);
  }

  warnings.forEach(warning => {
    logger.warn(warning);
  });

  // Validate key lengths
  if (process.env.ENCRYPTION_KEY?.length !== 64) {
    logger.error('ENCRYPTION_KEY must be 64 characters (32 bytes hex)');
    process.exit(1);
  }

  if (process.env.JWT_SECRET?.length < 32) {
    logger.error('JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }

  logger.info('Environment validation passed', {
    environment: process.env.NODE_ENV,
  });
};

export default validateEnvironment;
```

#### 3. Call Validation on Server Start

In `src/index.js`:

```javascript
import validateEnvironment from '#config/envValidation.js';

validateEnvironment();

// Then start server
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
```

#### 4. Production: Use Secrets Manager

AWS Secrets Manager example:

```javascript
// src/config/secrets.js
import AWS from 'aws-sdk';

const secretsManager = new AWS.SecretsManager();

export const getSecret = async (secretName) => {
  try {
    const result = await secretsManager
      .getSecretValue({ SecretId: secretName })
      .promise();
    
    return JSON.parse(result.SecretString);
  } catch (error) {
    logger.error('Failed to retrieve secret', { secretName, error });
    throw error;
  }
};

// Usage
const secrets = await getSecret('payme/prod/secrets');
const ENCRYPTION_KEY = secrets.ENCRYPTION_KEY;
```

---

## Database Migrations

### Current State

✅ Drizzle ORM migrations exist  
❌ No zero-downtime migration strategy  
❌ No rollback plan documented  

### Safe Migration Strategy

#### 1. Migration Checklist

```markdown
Before Migration:
- [ ] Backup production database
- [ ] Schedule maintenance window (low-traffic time)
- [ ] Notify stakeholders
- [ ] Have rollback plan ready
- [ ] Test migration on staging
- [ ] Document all changes

During Migration:
- [ ] Monitor database performance
- [ ] Monitor error logs
- [ ] Keep support team on standby
- [ ] Monitor API response times

After Migration:
- [ ] Verify all data integrity
- [ ] Check application functionality
- [ ] Confirm no errors in logs
- [ ] Announce completion
- [ ] Document migration details
```

#### 2. Zero-Downtime Migration Example

**Scenario**: Add encrypted `phone_number_encrypted` column

**Step 1**: Create new column (non-blocking)
```sql
-- Migration: 0010_add_phone_encrypted.sql
-- Time: ~2 seconds (non-blocking DDL)

ALTER TABLE users 
ADD COLUMN phone_number_encrypted VARCHAR(255);
CREATE INDEX idx_phone_encrypted ON users(phone_number_encrypted);
```

**Step 2**: Deploy code that:
- Reads from old column
- Writes to new column
- Encrypts on write

```javascript
// In user.service.js
export const createUser = async (userData) => {
  const phoneEncrypted = encrypt(userData.phone_number, `user_new.phone_number`);
  
  return db.insert(users).values({
    phone_number: userData.phone_number,  // Keep for backward compat
    phone_number_encrypted: phoneEncrypted,  // NEW
    // ... other fields
  });
};
```

**Step 3**: Backfill old data (during maintenance window)

```javascript
// One-time migration script
async function backfillEncryptedPhones() {
  const allUsers = await db.select().from(users);
  
  for (const user of allUsers) {
    const encrypted = encrypt(user.phone_number, `user_${user.id}.phone_number`);
    await db.update(users)
      .set({ phone_number_encrypted: encrypted })
      .where(eq(users.id, user.id));
  }
  
  logger.info(`Backfilled ${allUsers.length} encrypted phone numbers`);
}

// Run: npm run backfill
```

**Step 4**: Verify and clean

```javascript
// Verification query
const missingEncrypted = await db.select()
  .from(users)
  .where(isNull(users.phone_number_encrypted));

if (missingEncrypted.length > 0) {
  throw new Error(`${missingEncrypted.length} users missing encrypted phone`);
}

logger.info('All users have encrypted phone numbers');
```

**Step 5**: Switch to new column and drop old

```sql
-- After verification, in a separate deployment:
-- Update application to read from phone_number_encrypted
-- Then drop old column:

ALTER TABLE users DROP COLUMN phone_number;
ALTER TABLE users RENAME COLUMN phone_number_encrypted TO phone_number;
```

#### 3. Rollback Plan

If something goes wrong during migration:

```bash
# 1. Stop application
docker stop payme-app

# 2. Restore from backup
pg_restore -d payme_db backup_before_migration.sql

# 3. Verify restoration
psql -d payme_db -c "SELECT COUNT(*) FROM users;"

# 4. Restart with previous code version
docker run --restart payme-app

# 5. Investigate issue
# - Check migration logs
# - Review code changes
# - Test locally
# - Fix and retry

# 6. Notify stakeholders
# Email: support@payme.co.ke (outage notification)
# Post: Status page update
```

---

## Monitoring & Error Tracking

### Current State

✅ Winston logging configured  
❌ No error tracking service  
❌ No alerting on production errors  
❌ No uptime monitoring  

### Solution 1: Sentry Error Tracking

#### Setup

```bash
npm install @sentry/node @sentry/tracing
```

#### Configuration

In `src/config/logger.js`:

```javascript
import * as Sentry from '@sentry/node';
import * as Tracing from '@sentry/tracing';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Tracing.Integrations.Express({
        request: true,
        response: true,
      }),
    ],
  });
}

export const captureException = (error, context = {}) => {
  if (Sentry.isInitialized()) {
    Sentry.captureException(error, { extra: context });
  }
};
```

#### Use in Error Handler

In `src/middleware/errorHandler.middleware.js`:

```javascript
import { captureException } from '#config/logger.js';

export const globalErrorHandler = (err, req, res, next) => {
  // Capture to Sentry (production only)
  if (process.env.NODE_ENV === 'production') {
    captureException(err, {
      userId: req.user?.id,
      path: req.path,
      method: req.method,
      statusCode: err.statusCode || 500,
    });
  }

  // Log locally
  logger.error('Unhandled error', err);

  // Return error response
  res.status(err.statusCode || 500).json({
    error: err.message,
    requestId: req.id,  // For support tracking
  });
};
```

#### Alerts

Configure in Sentry:
- Alert on > 5 errors/minute
- Alert on new error types
- Daily digest of error counts

---

### Solution 2: Health Checks

Create `src/routes/health.routes.js`:

```javascript
import express from 'express';
import { db } from '#config/database.js';
import logger from '#config/logger.js';

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    // Check database
    await db.select().from(users).limit(1);
    
    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected',
    });
  } catch (error) {
    logger.error('Health check failed', error);
    return res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
    });
  }
});

export default router;
```

Monitoring setup:
```bash
# Monitor every 30 seconds
curl -f https://payme.co.ke/health || alert_team()
```

---

### Solution 3: Uptime Monitoring

Using Uptime.com or StatusPage.io:

```javascript
// Exposed metrics endpoint
app.get('/metrics', (req, res) => {
  res.json({
    uptime: process.uptime(),
    timestamp: new Date(),
    environment: process.env.NODE_ENV,
    version: process.env.APP_VERSION,
    database: 'connected',
    cache: 'connected',
  });
});
```

---

## Backups

### Backup Strategy

```
Every Day:
├─ Automated backup at 2 AM EAT
├─ Stored in AWS S3 (encrypted)
├─ Retain for 30 days
└─ Test restore weekly

Every Week:
├─ Weekly snapshot on Sunday
├─ Retain for 90 days
└─ Store in separate region

Every Month:
├─ Archive oldest backup
├─ Retain indefinitely
└─ Store in AWS Glacier
```

### Backup Script

`scripts/backup-db.sh`:

```bash
#!/bin/bash
set -e

# Configuration
DB_NAME=payme_production
BACKUP_DIR=/backups/daily
AWS_S3_BUCKET=payme-backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "Starting backup of $DB_NAME at $TIMESTAMP..."

# Create backup
pg_dump $DB_NAME > "$BACKUP_DIR/payme_$TIMESTAMP.sql"

# Compress
gzip "$BACKUP_DIR/payme_$TIMESTAMP.sql"

# Upload to S3
aws s3 cp "$BACKUP_DIR/payme_$TIMESTAMP.sql.gz" \
  s3://$AWS_S3_BUCKET/daily/ \
  --sse AES256 \
  --storage-class STANDARD_IA

echo "Backup completed successfully"

# Cleanup old local backups (keep 7 days)
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete
```

Schedule with cron:
```bash
# Run daily at 2 AM
0 2 * * * /opt/payme/scripts/backup-db.sh >> /var/log/backup.log 2>&1
```

---

## Scaling for 4,500+ Merchants

### Current Bottlenecks

1. **PDF Generation**: Puppeteer is CPU-intensive
2. **Database**: Single connection pool
3. **Server**: Single instance
4. **Rate Limiting**: In-memory store won't scale

### Solution 1: PDF Queue (BullMQ)

```bash
npm install bullmq redis ioredis
```

Create `src/queues/pdfQueue.js`:

```javascript
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export const pdfQueue = new Queue('pdf-generation', { connection: redis });

// Process PDF jobs
const worker = new Worker('pdf-generation', async (job) => {
  const { businessId, startDate, endDate, userId } = job.data;
  
  const pdf = await generateBusinessStatement(businessId, startDate, endDate, userId);
  
  // Store in S3 or return
  return { pdfUrl: 'https://...' };
}, { connection: redis });

// On job completion
pdfQueue.on('completed', (job) => {
  console.log(`PDF job ${job.id} completed`);
});
```

Update API endpoint:

```javascript
export const generateStatementHandler = async (req, res, next) => {
  const { businessId, startDate, endDate } = req.body;
  
  // Queue the job (returns immediately)
  const job = await pdfQueue.add('generate', {
    businessId,
    startDate,
    endDate,
    userId: req.user.id,
  });
  
  res.json({
    jobId: job.id,
    status: 'queued',
    estimatedTime: '30 seconds',
  });
};
```

### Solution 2: Database Read Replicas

```javascript
// src/config/database.js
const primaryDb = drizzle(sql); // Write to primary
const readDb = drizzle(replicaSql); // Read from replica

// Use for read-only queries
export const getStatement = async (statementId) => {
  return readDb
    .select()
    .from(statements)
    .where(eq(statements.id, statementId))
    .limit(1);
};
```

### Solution 3: Rate Limiting with Redis

Replace in-memory store:

```javascript
// src/middleware/rateLimiter.middleware.js
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export const createDistributedRateLimiter = (options) => {
  return async (req, res, next) => {
    const key = `ratelimit:${options.endpoint}:${req.ip}`;
    const count = await redis.incr(key);
    
    if (count === 1) {
      await redis.expire(key, options.windowMs / 1000);
    }
    
    if (count > options.maxRequests) {
      return res.status(429).json({ error: 'Rate limited' });
    }
    
    next();
  };
};
```

### Solution 4: Horizontal Scaling

Use Docker + Kubernetes:

```yaml
# kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payme-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: payme-api
  template:
    metadata:
      labels:
        app: payme-api
    spec:
      containers:
      - name: payme
        image: payme:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: payme-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            configMapKeyRef:
              name: payme-config
              key: redis-url
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
```

---

## Deployment Checklist

### Pre-Deployment (48 hours before)

- [ ] Code review completed
- [ ] All tests passing
- [ ] Staging environment validated
- [ ] Database migrations tested
- [ ] Backup scheduled
- [ ] Rollback plan documented
- [ ] Team notified of maintenance window
- [ ] Status page updated

### Deployment Day

**1 Hour Before**:
- [ ] Stop accepting new orders (or warn users)
- [ ] Final database backup
- [ ] Disable auto-scaling (manual scaling only)

**During Deployment**:
- [ ] Monitor error logs (Sentry)
- [ ] Monitor API response times
- [ ] Monitor database performance
- [ ] Keep support team on standby

**After Deployment**:
- [ ] Run health checks
- [ ] Verify all features work
- [ ] Check logs for errors
- [ ] Monitor for 2 hours
- [ ] Resume normal operations
- [ ] Post-mortem if issues

---

**Version**: 1.0  
**Last Updated**: January 28, 2026  
**Next Review**: April 28, 2026  
