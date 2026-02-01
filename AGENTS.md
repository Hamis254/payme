# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

PayMe is a Node.js/Express API for managing business operations including sales, inventory/stock management, M-Pesa payments, and a token-based wallet system. It uses Drizzle ORM with PostgreSQL (Neon) and implements security via Arcjet for rate limiting and bot detection.

## Development Commands

### Running the Application

```bash
npm run dev              # Start development server with --watch
```

### Code Quality

```bash
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format code with Prettier
npm run format:check     # Check formatting without changes
```

### Database Operations

```bash
npm run db:generate      # Generate Drizzle migrations from schema changes
npm run db:migrate       # Apply migrations to database
npm run db:studio        # Open Drizzle Studio (database GUI)
```

**Important:** After modifying any model files in `src/models/`, always run `npm run db:generate` to create migrations, then `npm run db:migrate` to apply them.

## Architecture Overview

### Path Aliases

The project uses Node.js import maps (defined in `package.json`) for clean imports:

- `#config/*` → `./src/config/*`
- `#controllers/*` → `./src/controllers/*`
- `#middleware/*` → `./src/middleware/*`
- `#utils/*` → `./src/utils/*`
- `#models/*` → `./src/models/*`
- `#services/*` → `./src/services/*`
- `#validations/*` → `./src/validations/*`
- `#routes/*` → `./src/routes/*`

### Layered Architecture

The codebase follows a strict layered architecture:

1. **Routes** (`src/routes/`) - Define API endpoints and apply middleware
2. **Controllers** (`src/controllers/`) - Handle HTTP requests/responses, validate input with Zod schemas
3. **Services** (`src/services/`) - Contain business logic and database operations
4. **Models** (`src/models/`) - Define Drizzle ORM schemas (PostgreSQL tables)
5. **Validations** (`src/validations/`) - Zod schemas for request validation
6. **Middleware** (`src/middleware/`) - Auth and security checks
7. **Utils** (`src/utils/`) - Reusable utilities (JWT, cookies, M-Pesa integration, formatting)

### Core Modules

#### Authentication & Authorization

- JWT-based auth using cookies (`src/utils/jwt.js`, `src/utils/cookies.js`)
- Authentication middleware: `src/middleware/auth.middleware.js`
  - `authenticateToken` - Verifies JWT from cookie
  - `requireRole(['admin', 'user'])` - Role-based access control
- User roles: `admin`, `user`, `guest`

#### Security

- Arcjet integration (`src/config/arcjet.js`, `src/middleware/security.middleware.js`)
- Role-based rate limiting:
  - Guest: 5 requests/minute
  - User: 10 requests/minute
  - Admin: 20 requests/minute
- Bot detection and shield protection

#### Business Model

- Multi-tenant: One user can own multiple businesses
- Each business has:
  - A wallet with token balance (1 token ≈ KSH 2, used for sale transactions)
  - Stock/inventory tracking with FIFO costing
  - Sales records with M-Pesa integration
  - Payment configuration (till number, paybill, pochi la biashara, or send money)

#### Stock/Inventory Management

- **Products** (`src/models/stock.model.js`) - Product catalog per business
- **Stock Batches** - Track each purchase/restock with FIFO for accurate profit calculation
- **Stock Movements** - Audit log of all inventory changes (purchase, sale, spoilage, adjustment)
- FIFO deduction logic in `src/services/stock.service.js`

#### Sales & Payment Flow

1. Create sale (reserves 1 token from wallet)
2. Payment options:
   - **Cash**: Immediate completion, stock deducted
   - **M-Pesa**: STK push initiated, sale completed on callback success
3. Sale items track unit cost at time of sale for profit calculation
4. Stock automatically deducted using FIFO on payment completion

#### M-Pesa Integration

- Located in `src/utils/mpesa.js`
- Supports multiple products: `paybill`, `till`, `pochi` (pochi la biashara)
- Functions:
  - `getAccessToken()` - OAuth token from Safaricom
  - `initiateStkPush()` - Trigger STK push to customer phone
  - `initiateB2CSend()` - Business-to-customer payouts
- Environment: Sandbox by default, configurable via `MPESA_ENV`

#### Wallet & Tokens

- Token packages with discounts (e.g., 30 tokens = KSH 50, saves KSH 10)
- Token lifecycle: purchase → reserve (on sale creation) → charge (on sale completion) or refund (on failure)
- Tracked in `wallets`, `walletTransactions`, `tokenPurchases` tables

### Database

- **ORM**: Drizzle with Neon serverless PostgreSQL
- **Schema location**: All models in `src/models/*.js`
- **Configuration**: `drizzle.config.js`
- **Migrations**: Stored in `./drizzle` directory
- **Connection**: Via `src/config/database.js` exports `db` and `sql`

### Logging

- Winston logger (`src/config/logger.js`)
- Logs to:
  - `logs/error.log` (error level only)
  - `logs/combined.log` (all levels)
  - Console (non-production only)
- Log level: `process.env.LOG_LEVEL` (default: `info`)
- Morgan HTTP request logging integrated

## Code Style

### ESLint Rules

- 2-space indentation
- Single quotes
- Semicolons required
- No unused vars (except prefixed with `_`)
- Arrow callbacks preferred
- ES6+ syntax (const/let, object shorthand)

### Prettier Configuration

- Semi: true
- Single quotes: true
- Print width: 80
- Tab width: 2
- Arrow parens: avoid
- End of line: LF

## Key Patterns

### Error Handling

Controllers use try-catch with specific error messages:

```javascript
try {
  // logic
} catch (e) {
  logger.error('Context message', e);
  if (e.message === 'Specific error') {
    return res.status(400).json({ error: 'User-friendly message' });
  }
  next(e); // Pass to error handler
}
```

### Validation

All request validation uses Zod schemas from `src/validations/`:

```javascript
const validationResult = schema.safeParse(req.body);
if (!validationResult.success) {
  return res.status(400).json({
    error: 'Validation failed',
    details: formatValidationError(validationResult.error),
  });
}
```

### Database Transactions

Critical operations (especially involving wallet/stock) use Drizzle transactions:

```javascript
await db.transaction(async (tx) => {
  // Use tx instead of db for all queries
  await tx.insert(...).values(...);
  await tx.update(...).set(...);
});
```

### Business Ownership Verification

Always verify user owns the business before operations:

```javascript
const [business] = await db
  .select()
  .from(businesses)
  .where(
    and(eq(businesses.id, businessId), eq(businesses.user_id, req.user.id))
  )
  .limit(1);

if (!business) {
  return res.status(403).json({ error: 'Business not found or access denied' });
}
```

## Environment Variables

Required `.env` variables:

- `DATABASE_URL` - Neon PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT signing/verification
- `ARCJET_KEY` - Arcjet API key for security
- `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` - Safaricom Daraja credentials
- `MPESA_SHORTCODE_PAYBILL`, `MPESA_PASSKEY_PAYBILL` - For paybill payments
- `MPESA_SHORTCODE_TILL`, `MPESA_PASSKEY_TILL` - For till payments
- `MPESA_SHORTCODE_POCHI`, `MPESA_PASSKEY_POCHI` - For pochi la biashara
- `MPESA_CALLBACK_URL` - Webhook URL for M-Pesa callbacks
- `MPESA_B2C_INITIATOR`, `MPESA_B2C_SECURITY_CREDENTIAL`, `MPESA_B2C_SHORTCODE` - For B2C payouts
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- `NODE_ENV` - Environment (production/development)
- `MPESA_ENV` - M-Pesa environment (sandbox/production, default: sandbox)

## Testing Notes

- No test framework currently configured (ESLint config references Jest but not installed)
- When adding tests, install a testing framework and update `package.json` scripts
- Use the `/health` endpoint to verify server is running

## API Structure

Base URL: `/api`

Main route groups:

- `/api/auth` - Authentication (signup, signin, signout)
- `/api/users` - User management
- `/api/businesses` - Business CRUD and settings
- `/api/stock` - Inventory and stock management
- `/api/sales` - Sales creation and payment processing

All routes except `/api/auth` require authentication via `authenticateToken` middleware.
