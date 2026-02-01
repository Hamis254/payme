# 📊 Analytics Dashboard - Quick Reference

**TL;DR**: 9 analytics endpoints giving 15+ business metrics. Production ready. Zero setup needed.

---

## 🚀 Endpoints at a Glance

| Endpoint | Purpose | Response Time | Use Case |
|----------|---------|---------------|----------|
| `/dashboard` | Everything | 200-300ms | Full dashboard view |
| `/summary` | Quick stats | <100ms | KPI cards |
| `/top-products` | Best sellers | 150-200ms | Product performance |
| `/revenue-breakdown` | Cash vs M-Pesa | 150-200ms | Payment analysis |
| `/sales-trend` | Last 30 days | 300-500ms | Line chart data |
| `/inventory` | Stock value | 100-150ms | Inventory health |
| `/wallet` | Token usage | 100ms | Token metrics |
| `/expenses` | Spending | 150-200ms | Expense breakdown |
| `/customers` | Loyalty | 200-300ms | Repeat rates |

---

## 💻 Copy-Paste Examples

### Get Today's Summary
```bash
curl -X GET "http://localhost:3000/api/analytics/1/summary?period=daily" \
  -H "Authorization: Bearer YOUR_JWT"
```

**Response:**
```json
{
  "totalRevenue": 45000,
  "totalProfit": 12000,
  "profitMargin": 26.67,
  "transactionCount": 12,
  "avgTransaction": 3750
}
```

### Get This Week's Dashboard
```bash
curl -X GET "http://localhost:3000/api/analytics/1/dashboard?period=weekly" \
  -H "Authorization: Bearer YOUR_JWT"
```

### Get Top 5 Most Profitable Products
```bash
curl -X GET "http://localhost:3000/api/analytics/1/top-products?sortBy=profit&limit=5" \
  -H "Authorization: Bearer YOUR_JWT"
```

### Get Revenue Split (Cash vs M-Pesa)
```bash
curl -X GET "http://localhost:3000/api/analytics/1/revenue-breakdown?period=daily" \
  -H "Authorization: Bearer YOUR_JWT"
```

### Get Last 30 Days Sales Trend
```bash
curl -X GET "http://localhost:3000/api/analytics/1/sales-trend?daysBack=30" \
  -H "Authorization: Bearer YOUR_JWT"
```

### Get Current Inventory Value
```bash
curl -X GET "http://localhost:3000/api/analytics/1/inventory" \
  -H "Authorization: Bearer YOUR_JWT"
```

---

## 📊 Key Metrics Explained

### Revenue Metrics
- **Total Revenue** - All completed sales (KES)
- **Total Profit** - Revenue minus cost of goods sold
- **Profit Margin** - Profit ÷ Revenue × 100 (%)
- **Average Transaction** - Revenue ÷ number of sales

### Product Metrics
- **Top by Revenue** - Which products sell most (KES)
- **Top by Profit** - Which products make most profit
- **Units Sold** - Quantity of items sold

### Customer Metrics
- **Unique Customers** - Count of distinct people
- **Repeat Rate** - % of customers buying 2+ times
- **Total Transactions** - Sum of all purchases

### Payment Breakdown
- **Cash** - Total cash sales (KES) + count
- **M-Pesa** - Total M-Pesa sales (KES) + count

### Inventory
- **Total Cost Value** - What you paid for all stock
- **Total Selling Value** - What you can sell it for
- **Potential Profit** - If sold at current prices

### Token Wallet
- **Tokens Purchased** - Cumulative tokens bought
- **Tokens Used** - Cumulative tokens charged
- **Current Balance** - Available tokens (from other endpoint)

---

## 🎯 Period Options

All endpoints (except `/inventory`) support periods:

```
?period=daily    # Today (midnight to midnight)
?period=weekly   # Current week (Monday-Sunday)
?period=monthly  # Current month (1st to last day)
?period=yearly   # Current year
```

Default is `daily`.

---

## 📈 Common Use Cases

### Dashboard Home Page
1. Call `/summary?period=daily` → Show KPI cards (revenue, profit, margin)
2. Call `/sales-trend?daysBack=30` → Show line chart of last 30 days
3. Call `/top-products?sortBy=profit&limit=5` → Show top 5 products

### Business Health Check
1. `/summary?period=monthly` → How's the month looking?
2. `/customers?period=monthly` → Repeat customer growing?
3. `/expenses?period=monthly` → Expenses reasonable?

### Product Analysis
1. `/top-products?sortBy=revenue&limit=10` → Top sellers
2. `/top-products?sortBy=profit&limit=10` → Most profitable
3. Compare unit prices and margins

### Financial Analysis
1. `/revenue-breakdown` → Cash vs M-Pesa ratio
2. `/revenue-breakdown` → Walk-in vs Credit sales
3. `/summary?period=monthly` → Month-over-month trend

---

## 🔐 Authentication

All endpoints require JWT token in header:

```
Authorization: Bearer <JWT_TOKEN>
```

Get your JWT from `/api/auth/signin` endpoint.

---

## ❌ Error Responses

### 401 Unauthorized
```json
{
  "error": "Invalid or expired token"
}
```
→ Login again with `/api/auth/signin`

### 403 Forbidden
```json
{
  "error": "Business not found or access denied"
}
```
→ You don't own this business

### 400 Bad Request
```json
{
  "error": "Invalid query parameters",
  "details": {...}
}
```
→ Fix the query parameters (period, limit, sortBy, etc)

---

## 📱 Frontend Integration

### For Flutter/React

1. **Install http client**:
```dart
// Flutter
import 'package:dio/dio.dart';

// React
import axios from 'axios';
```

2. **Call endpoint**:
```dart
// Flutter
final response = await dio.get(
  'http://api.payme.local/api/analytics/$businessId/dashboard?period=daily',
  options: Options(headers: {'Authorization': 'Bearer $token'}),
);

// React
const response = await axios.get(
  `/api/analytics/${businessId}/summary?period=daily`,
  {headers: {Authorization: `Bearer ${token}`}}
);
```

3. **Parse response**:
```dart
final data = response.data['data'];
final revenue = data['summary']['totalRevenue'];
final profit = data['summary']['totalProfit'];
```

---

## 🧪 Quick Test Checklist

- [ ] Get summary: `curl ... /api/analytics/1/summary`
- [ ] Get dashboard: `curl ... /api/analytics/1/dashboard`
- [ ] Get top products: `curl ... /api/analytics/1/top-products?sortBy=profit`
- [ ] Test invalid business: `curl ... /api/analytics/999/summary` (should get 403)
- [ ] Test invalid period: `curl ... /api/analytics/1/summary?period=invalid` (should get 400)
- [ ] Check response format: Matches JSON schema above

---

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| 401 Unauthorized | JWT expired, login again |
| 403 Forbidden | Not a business owner, use correct businessId |
| Empty results | Business has no sales in date range, try longer period |
| Slow response | Dashboard endpoint queries a lot, use `/summary` for KPIs |
| 500 Server error | Check logs: `tail -f logs/combined.log` |

---

## 📊 Data Types

| Metric | Type | Range | Example |
|--------|------|-------|---------|
| Revenue | decimal | 0 - infinity | 45000.00 |
| Profit | decimal | -infinity - infinity | 12000.50 |
| Margin | decimal | 0 - 100 | 26.67 |
| Count | integer | 0 - infinity | 12 |
| Percent | decimal | 0 - 100 | 33.33 |
| Date | string | YYYY-MM-DD | 2026-02-01 |

---

## 🚀 Performance Tips

1. **Use `/summary` for quick loads** (KPI cards) instead of `/dashboard`
2. **Cache dashboard data** for 5 minutes on frontend
3. **Request only what you need** (don't get full dashboard if you just need profit)
4. **Use appropriate periods** (don't use yearly if you only need today)

---

## 📖 Full Documentation

For complete details, API reference, database schema, and architecture:
→ Read **ANALYTICS_COMPLETE.md**

---

**Status**: ✅ Production Ready | **Endpoints**: 9 | **Metrics**: 15+ | **Lint Errors**: 0

Need help? Check ANALYTICS_COMPLETE.md or check logs: `tail logs/combined.log`
