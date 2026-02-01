# PayMe Records System - Architecture Analysis

## 🎯 System Overview

The **Records System** is the backbone of PayMe's financial tracking. It's a multi-faceted financial ledger that:
1. Logs ALL business transactions (sales, higher purchases, credits, inventory, expenses)
2. Syncs real-time data to Google Sheets 
3. Generates bank-grade PDF statements with digital verification
4. Powers daily sales reports and financial analytics
5. Enforces security via a "Revenue Guard" token tax system

---

## 📋 Core Architecture (From record.model.js Comments)

### [1] Core Responsibility
**Single source of truth for every billable event**
- Governs structure for: Daily Reports, Higher Purchase, Credit, Inventory, Expenses
- Provides data for bank-grade credit scoring
- All transaction types stored in **unified, multi-tenant tables** scoped by `business_id`

### [2] Revenue Guard & Security (The "2-Bob Token Tax")
This is a **monetization + security mechanism**:

```
Every Record Creation = 1 Token Deducted from Wallet
├─ MANDATORY: Must pass Revenue Guard middleware check
├─ ATOMICITY: Token deduction + Record creation = single transaction
│  ├─ If token deduction fails → Record creation rolls back
│  └─ If record creation fails → Token refunded
└─ IMMUTABILITY: All records READ-ONLY for users (no edit/delete)
```

**Purpose**: 
- Monetizes daily record-keeping (users pay per transaction logged)
- Prevents spam/junk data (cost barrier)
- Creates audit trail (who paid for what record)

### [3] Data Architecture: Triple-Entry Logging

```
                    ┌─────────────┐
                    │  PostgreSQL │  (Primary: Source of Truth)
                    │    (Neon)   │  - All CRUD operations
                    └──────┬──────┘
                           │ Real-time Sync
                    ┌──────▼──────┐
                    │Google Sheets│  (Live Mirror)
                    │   (Live)    │  - Append-only log
                    └──────┬──────┘
                           │ On-demand Export
                    ┌──────▼──────┐
                    │  PDF Export  │  (Signed & Verified)
                    │  (Digitally  │  - Bank-grade statements
                    │  Signed)     │  - SHA-256 fingerprints
                    └─────────────┘
```

**Key Features**:
- **MULTI-TENANCY**: Unified tables [sales, hp, credits, inventory, expenses] scoped by `business_id`
- **SYNC**: Automatic real-time appends to Google Sheets for every new record
- **TRIPLE-ENTRY**: Data in DB → Google Sheets mirror → PDF export trail

### [4] Schema & M-Pesa Logic

#### Sales Records
```
- Item_ID: Product identifier
- Qty: Quantity sold
- Mode: 'Cash' or 'Mpesa'
- Amount: Transaction value
- Timestamp: When transaction occurred
```

#### M-Pesa Auto-Fill
```
If Payment Mode = 'Mpesa':
  - Code: M-Pesa receipt number
  - Sender Name: Customer name from callback
  - Sender Phone: From callback
Else (Cash):
  - All M-Pesa fields = 'N/A'
```

#### Inventory Tracking
- Real-time stock quantities
- "Tap-to-View" detail capability
- Automatic sync to Google Sheets

### [5] In-App Data Tables: "Tap-to-View" Experience

**Design Constraints**:
- ✅ **NATIVE VIEW**: Users view data via internal PayMe data-table components
- ❌ **NO EXTERNAL APPS**: Must NOT trigger Google Sheets or Excel
  - "Tap to View" opens record details **within** the app
  - Links to Google Sheets are reference links only
- 📊 **INSIGHTS ON-THE-FLY**: Dashboard calculates:
  - Total Sales
  - Daily Average
  - High/Low sales days
  - All computed from database (not Google Sheets)

### [6] Official Statement Engine (PDF Export)

#### Rolling History Window
```javascript
// Example: 26/12/25 to 26/01/26 (30-day window)
const now = new Date();
const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
// Fetch ALL transactions in this window
```

#### Statement Format
- **UNBOUNDED FETCH**: Renders ALL transactions regardless of page count
- **CONTINUOUS LEDGER**: NO daily sub-totals
- **SINGLE GRAND TOTAL**: Only at very bottom of final page
- **BANK-GRADE SECURITY**: 
  - SHA-256 Digital Fingerprinting
  - QR Verification codes
  - KCB/Equity/Bank trust format

#### Verification Code
```javascript
generateVerificationCode() {
  // Returns: 9-character code (e.g., "P567-M344-E656")
  // Format: XXX-XXX-XXX
  // Used to: Create unique QR code for verification
  // Stored in: PDF footer + verification database
}
```

---

## 🗂️ Record Types (5 Main Categories)

### 1. **Daily Sales Reports**
- Individual sales transactions
- Payment method (Cash/Mpesa)
- Item, quantity, amount
- Real-time Google Sheets sync

### 2. **Higher Purchase (HP) Records**
- Bulk purchases on credit
- Financing terms tracking
- Repayment status
- Often precedes credit records

### 3. **Credit Records**
- Credit given to customers
- Amount, due date, status
- Interest calculation (if applicable)
- Recovery tracking

### 4. **Inventory Records**
- Stock purchases and updates
- FIFO costing
- Spoilage/waste tracking
- Quantities and valuations

### 5. **Expense Records**
- Operating expenses
- Utility costs
- Transportation
- Misc. business costs

---

## 📁 Current Implementation Status

### ✅ Planned Files
- `record.model.js` - **✅ DOCUMENTED** (46 lines of architectural comments)
- `record.service.js` - **⏳ PLACEHOLDER** (TODO list)
- `record.controller.js` - **⏳ PLACEHOLDER** (TODO list)
- `record.routes.js` - **⏳ PLACEHOLDER** (TODO list)
- `record.validation.js` - **⏳ PLACEHOLDER** (TODO list)

### ✅ Partially Implemented
- `statementService.js` - **PSEUDO-CODE** (Structure exists, functions need implementation)
- `statementHeader.html` - **Template exists** (empty)
- `statementBody.html` - **Template exists** (empty)
- `statementFooter.html` - **Template exists** (empty)

---

## 🔧 Technology Stack Required

### Dependencies Needed
```json
{
  "puppeteer": "^21.0.0",           // PDF generation from HTML
  "handlebars": "^4.7.0",           // Template rendering
  "qrcode": "^1.5.0",               // QR code generation
  "googleapis": "^118.0.0",         // Google Sheets API
  "google-auth-library": "^8.8.0"   // OAuth for Google
}
```

### Google Sheets Integration
- OAuth 2.0 for authentication
- Append-only mode (no overwrites)
- Real-time sync on record creation
- Separate sheet per business

### PDF Generation Pipeline
```
Data (DB) → Handlebars Template → Puppeteer → PDF Buffer
         ↓
    Inject vars (totals, dates, business info)
         ↓
    Render A4 layout with CSS
         ↓
    Generate QR code for verification
         ↓
    Return PDF + verification code
```

---

## 🔒 Security & Revenue Guard Flow

### Revenue Guard Middleware (2-Bob Token Tax)
```javascript
async recordGuard(req, res, next) {
  const { business_id } = req.params;
  const { business } = req;
  
  // 1. Check token balance
  if (business.wallet.tokens < 1) {
    return res.status(402).json({ 
      error: 'Insufficient tokens', 
      message: 'Purchase tokens to record transactions'
    });
  }
  
  // 2. Deduct token (will rollback if record fails)
  const transaction = await db.transaction(async tx => {
    // A. Deduct token
    await tx.update(wallets)
      .set({ tokens: wallet.tokens - 1 })
      .where(eq(wallets.business_id, business_id));
    
    // B. Create record in appropriate table
    const record = await tx.insert(records_table)
      .values({ ...recordData })
      .returning();
    
    // C. Sync to Google Sheets
    await syncToGoogleSheets(record);
    
    return record;
  });
  
  next();
}
```

### Idempotency Protection
- Records table should have UNIQUE constraint on callback IDs
- Prevents duplicate record entries for same M-Pesa payment
- Especially important for Mpesa callback handling

---

## 📊 Data Flow Diagram

```
User Action (Create Sale/HP/Credit/Expense)
    ↓
Revenue Guard Check (Sufficient Tokens?)
    ↓
Create Record (in appropriate table)
    ↓
Deduct 1 Token from Wallet ─────┐
    ↓                            │
Log Transaction ────────────────┼───────────────┐
    ↓                            │               │
Transaction Atomic? ──Yes───────┘               │
    ↓                                           │
No ──→ Rollback both Record + Token Deduction  │
    ↓                                           │
Sync to Google Sheets ◄─────────────────────────┘
    ↓
Generate QR Code (if PDF export)
    ↓
Return Response to User
    ↓
Dashboard Updates (Real-time)
    ↓
User views in "Tap-to-View" tables (Native UI)
    ↓
On demand: Export as PDF (with digital verification)
```

---

## 🚀 Implementation Roadmap

### Phase 1: Core Record CRUD
- [ ] Implement `record.service.js` functions:
  - `createSalesRecord(businessId, data)`
  - `createHPRecord(businessId, data)`
  - `createCreditRecord(businessId, data)`
  - `createExpenseRecord(businessId, data)`
  - `getRecords(businessId, filters)`

### Phase 2: Google Sheets Integration
- [ ] OAuth2 setup for Google account
- [ ] Append-only sync function
- [ ] Error handling & retry logic
- [ ] Batch sync (if needed)

### Phase 3: PDF Statement Generation
- [ ] Implement `statementService.js` fully:
  - Fetch 30-day rolling data
  - Calculate totals (cash, mpesa, hp, credit, expense)
  - Generate verification codes
  - Render HTML templates with Handlebars
  - Generate QR codes
  - Convert to PDF with Puppeteer

### Phase 4: In-App Views
- [ ] "Tap-to-View" table components (native UI)
- [ ] Dashboard insights (Daily avg, High/Low days)
- [ ] Filter & search functionality
- [ ] Export to Google Sheets link (reference)

### Phase 5: Advanced Features
- [ ] Statement history versioning
- [ ] Digital signature verification
- [ ] KCB/Equity bank integration
- [ ] Credit scoring algorithm
- [ ] Automated monthly statements

---

## 📝 Key Implementation Notes

### Record Atomicity
**CRITICAL**: All record creation must be atomic with token deduction:
```javascript
await db.transaction(async tx => {
  // Both succeed or both fail
  await deductToken(tx);
  await createRecord(tx);
  await syncToGoogleSheets(record); // Can be async after commit
});
```

### Google Sheets Format
Expected structure per business:
```
Business: John's Grocery
Date    | Time  | Item    | Qty | Mode  | Amount | M-Pesa Code | Sender Name | Notes
--------|-------|---------|-----|-------|--------|-------------|-------------|-------
26/01   | 09:15 | Maize   | 10  | Cash  | 5000   | N/A         | N/A         | Bulk
26/01   | 10:30 | Sugar   | 5   | Mpesa | 2500   | LHU2143H    | Jane Doe    | Retail
```

### PDF Statement Structure
```
┌────────────────────────────────┐
│  STATEMENT HEADER              │
│  ├─ Business Name/Logo         │
│  ├─ Period: 26/12/25-26/01/26  │
│  └─ Generated: 26/01/26        │
├────────────────────────────────┤
│  LEDGER (All Transactions)     │
│  Date   | Description | Amount │
│  ...    | ...         | ...    │
├────────────────────────────────┤
│  FINANCIAL SUMMARY             │
│  ├─ Cash Sales: 150,000        │
│  ├─ M-Pesa Sales: 75,000       │
│  ├─ HP Collection: 25,000      │
│  ├─ Credit Recovery: 10,000    │
│  ├─ Total Expenses: (30,000)   │
│  └─ NET PROFIT: 230,000        │
├────────────────────────────────┤
│  FOOTER (Verification)         │
│  ├─ Code: P567-M344-E656       │
│  ├─ QR Code: [████████]        │
│  └─ "Scan to verify this PDF"  │
└────────────────────────────────┘
```

---

## 🎓 Key Concepts

### Revenue Guard = Monetization Layer
Every record costs 1 token (~2 KES) to create. This:
- Monetizes the app (users pay to use features)
- Prevents spam
- Creates revenue stream
- Builds in anti-fraud mechanism

### Triple-Entry Logging = Audit Trail
- **DB**: Real transaction data
- **Google Sheets**: Public/shareable mirror
- **PDF**: Offline, verifiable snapshot

### Atomicity = Data Integrity
Transaction either fully completes or fully rolls back. No partial states.

### "Tap-to-View" = User Experience
- Fast, native in-app views (not external apps)
- Instant access to transaction history
- Dashboard insights computed on-the-fly

---

## ❓ Questions for Implementation

1. **Google Sheets Auth**: Should each business connect their own Sheet, or centralized PayMe Sheet?
2. **Sync Timing**: Real-time or batch? (Currently assumed real-time)
3. **PDF Naming**: Should include business name + date? (e.g., "Johns_Grocery_26012026.pdf")
4. **Credit Scoring**: What algorithm for bank-grade credit scores?
5. **Statement History**: How many months to keep? (Unlimited?)

---

## 📞 Summary

The **Records System** is PayMe's financial engine that:
- ✅ Logs every transaction with token-based access control
- ✅ Syncs to Google Sheets for public/shareable records
- ✅ Generates bank-grade PDF statements with QR verification
- ✅ Powers analytics, credit scoring, and reporting
- ✅ Enforces atomicity & immutability for security

**Current Status**: Architecture documented, implementation placeholder files ready for development.

