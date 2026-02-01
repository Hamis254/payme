# Spoiled Stock - Quick Reference

## What's New

Complete system for tracking inventory spoilage with pattern analysis to help businesses reduce losses.

---

## Key Files

```
✅ src/models/spoiledStock.model.js - Database schema
✅ src/services/spoiledStock.service.js - Business logic
✅ src/controllers/spoiledStock.controller.js - HTTP handlers
✅ src/routes/spoiledStock.routes.js - REST API
✅ src/validations/spoiledStock.validation.js - Input validation
```

All files: **LINT-CLEAN (0 errors)**

---

## API Endpoints

### Record Spoilage
```bash
POST /api/spoilage/record
{
  "businessId": 5,
  "productId": 12,
  "quantity": 5,
  "spoilageType": "damage",      # damage|expiration|storage|handling|theft|other
  "reason": "Dropped during unloading",
  "notes": "Optional context"
}
```

### List Incidents
```bash
GET /api/spoilage/5?spoilageType=damage&limit=20
```

### View Summary
```bash
GET /api/spoilage/5/summary
# Returns: total_incidents, total_quantity, total_loss_value
```

### Get Analytics
```bash
GET /api/spoilage/5/analytics?analysisType=highest_loss&limit=10

# analysisType options:
#   - summary: Total stats
#   - by_type: Distribution by type
#   - monthly_trend: Trend over time
#   - top_spoiled: Most frequent products
#   - highest_loss: Highest value losses
#   - spoilage_rate: Highest risk products
```

### Update Record
```bash
PATCH /api/spoilage/5/1
{ "reason": "Updated reason", "notes": "..." }
```

### Delete Record
```bash
DELETE /api/spoilage/5/1
# Automatically restores stock
```

---

## Spoilage Types

| Type | Example |
|------|---------|
| **expiration** | Milk expired on shelf |
| **damage** | Broken packaging, leaks |
| **storage** | Moisture exposure, pests |
| **handling** | Dropped, crushed items |
| **theft** | Missing inventory |
| **other** | Other causes |

---

## Example Response

```json
{
  "success": true,
  "message": "Spoilage recorded successfully",
  "spoilage": {
    "id": 1,
    "product_id": 12,
    "quantity_spoiled": "5.000",
    "total_loss_value": "12500.00",
    "spoilage_type": "damage",
    "reason": "Dropped during unloading",
    "created_at": "2026-01-28T10:30:00Z"
  },
  "request_id": "uuid"
}
```

---

## Key Features

✅ **Atomic Transactions** - Stock updated automatically  
✅ **Loss Tracking** - Financial impact calculated  
✅ **Pattern Analysis** - Identify trends and problems  
✅ **Audit Trail** - Complete history of incidents  
✅ **Revenue Guard** - 1 token per record (tracking fee)  

---

## How It Works

1. **Record Spoilage** → 1 token deducted from balance
2. **Stock Updated** → product.current_quantity decremented automatically
3. **Cost Calculated** → unit_cost × quantity_spoiled = loss_value
4. **Movement Logged** → Audit trail entry created
5. **Analytics Ready** → Data available for pattern analysis

---

## Business Uses

**Problem Identification**:
- Which products spoil most frequently?
- What's the financial impact?
- Which suppliers have quality issues?

**Process Improvement**:
- Are seasonal patterns causing losses?
- Which storage conditions need improvement?
- When should we increase inspections?

**Negotiation**:
- How much did supplier damage cost us?
- What's the spoilage rate for each product?
- Which items need better handling?

---

## Example Queries

### Top spoiled products (by frequency)
```javascript
const topSpoiled = await getTopSpoiledProducts(businessId, 5);
// Result: "Fresh Milk (40 incidents), Butter (25 incidents)..."
// Action: Improve refrigeration or buy better-quality supplies
```

### Highest loss products (by value)
```javascript
const highest = await getHighestLossProducts(businessId, 5);
// Result: "Cooking Oil (50K loss), Fish (40K loss)..."
// Action: Invest in better storage for high-value items
```

### Monthly trends
```javascript
const trend = await getMonthlySpoilageTrend(businessId);
// Result: "Jan=25K, Feb=35K, Mar=20K"
// Action: If Feb is peak season, increase inspection frequency
```

### Products at highest risk
```javascript
const atRisk = await getHighestSpoilageRateProducts(businessId, 5);
// Result: "Fresh Milk (15.5% spoilage rate), Bread (8.2%)..."
// Action: Review storage and ordering for high-risk items
```

---

## Integration Notes

- Requires migration: creates `spoiled_stock` table with indexes
- Requires route registration in main app.js
- Uses existing `products` and `businesses` tables
- Integrates with `stockMovements` for audit trail
- Requires `revenueGuard` middleware (1 token per record)

---

## Revenue Impact

Each spoilage record costs **1 token (2 KES)** to document.

Benefits:
- Discourages frivolous entries
- Funds data collection and analysis
- Creates accountability for warehouse management

---

## Error Codes

| Code | Error | Solution |
|------|-------|----------|
| 400 | Invalid spoilage type | Use: damage, expiration, storage, handling, theft, other |
| 400 | Insufficient stock | Quantity spoiled > available |
| 404 | Product not found | Verify product exists |
| 404 | Spoilage not found | Verify record exists |
| 402 | Insufficient tokens | User needs to buy more tokens |

---

## Quick Test

```bash
# 1. Record spoilage
curl -X POST http://localhost:3000/api/spoilage/record \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "businessId": 5,
    "productId": 12,
    "quantity": 3,
    "spoilageType": "damage",
    "reason": "Dropped during delivery"
  }'

# 2. Check summary
curl http://localhost:3000/api/spoilage/5/summary \
  -H "Authorization: Bearer {token}"

# 3. Get analytics
curl 'http://localhost:3000/api/spoilage/5/analytics?analysisType=highest_loss&limit=5' \
  -H "Authorization: Bearer {token}"
```

---

## Status

✅ **COMPLETE**  
✅ **LINT-CLEAN**  
✅ **TESTED**  
✅ **READY TO MIGRATE & DEPLOY**
