# 🚀 Quick Reference Card - PayMe Flutter Development

**Print this page** for your desk during development.

---

## 📱 App Bottom Navigation

```
┌─────────────────────────────────────┐
│         Dashboard    [5 tabs]        │
├─────────────────────────────────────┤
│ [Home] [Inventory] [Sales] [Credit] │
│                        [Settings]   │
└─────────────────────────────────────┘
```

---

## 🔐 Auth Flow

```
Splash → Token Valid?
         ├─ NO → Login Screen
         │        ├─ Email + Password
         │        ├─ Get JWT token
         │        └─ Save securely
         │
         └─ YES → Dashboard
```

---

## 💼 Business Model

- **One User** = Multiple businesses
- **One Business** = One wallet, one stock, one payment config
- **Selected Business** = Global state (Riverpod provider)
- **Floating Button** = Switch business (tap anywhere)

---

## 📊 Core Data Models

```dart
User
├── id, name, email, phone, role

Business
├── id, name, location, paymentMethod, paymentIdentifier

Product
├── id, name, basePrice, currentStock

Sale
├── id, customername, totalAmount, status, items[]

SaleItem
├── productId, quantity, unitPrice, unitCost

Wallet
├── tokenBalance, walletBalance (KES)

CreditAccount
├── id, customerName, creditLimit, outstandingBalance

Expense
├── id, category, amount, date
```

---

## 🛒 Sales Creation Flow

```
Dashboard
  ↓ "New Sale" button
Product Selection
  ↓ Add items to cart
Review Sale
  ├─ Total, Profit, Items
  ↓
Select Payment
  ├─ Cash: Confirm → Complete
  └─ M-Pesa: STK → Await callback → Complete
```

---

## 💰 Wallet Transactions

```
Purchase: +30 tokens (KSH 50)
Reserve: -1 token (on sale creation)
Charge: -1 token (on payment completion)
Refund: +1 token (on cancellation)
```

---

## 🔄 API Endpoint Categories

| Category | Routes | Example |
|----------|--------|---------|
| **Auth** | 3 | POST /api/auth/sign-in |
| **Business** | 4 | GET /api/businesses |
| **Inventory** | 5 | POST /api/stock/products |
| **Sales** | 6 | POST /api/sales |
| **Wallet** | 4 | GET /api/wallet/business/:id |
| **Credit** | 4 | POST /api/credit |
| **HP** | 7 | POST /api/higher-purchase/:id/create |
| **Expense** | 3 | POST /api/expense/:id/record |
| **Spoilage** | 2 | POST /api/spoiled-stock |
| **Payment Config** | 4 | POST /api/payment-config/setup |

---

## ⚡ Critical Implementation Notes

### Phone Numbers
```
Accept: 0712345678 or +254712345678
Validate: Kenyan format only
Store: Normalized to +254...
Display: 0712345678 (local format)
```

### Tokens
```
1 Token = KES 2
Sale Creation = Reserve 1 token
Payment Complete = Charge 1 token
M-Pesa Purchase = Bulk tokens with discount
```

### Stock (FIFO)
```
Add Stock → Create batch with unit_cost
Deduct Stock → Use oldest batch first (FIFO)
Calculate Profit → sum(qty * (unit_price - unit_cost))
```

### M-Pesa
```
Business Payment → Uses paymentConfigs (per-business)
Wallet Purchase → Uses fixed paybill 650880
Both → STK push to customer's phone
Callback → Safaricom POSTs to /api/sales/mpesa/callback
```

---

## 🎨 Riverpod Patterns

### **Provider Types**

```dart
// Read-only data
final productListProvider = FutureProvider<List<Product>>((ref) {
  return api.getProducts(businessId);
});

// Mutable state (like Redux)
final selectedBusinessProvider = StateProvider<Business?>((ref) => null);

// Computed/derived state
final walletProvider = FutureProvider<Wallet>((ref) {
  final api = ref.watch(apiProvider);
  final business = ref.watch(selectedBusinessProvider);
  return api.getWallet(business!.id);
});

// Complex state with methods
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(ref);
});
```

### **Usage**

```dart
// Read in widget
final products = ref.watch(productListProvider);

// Modify state
ref.read(selectedBusinessProvider.notifier).state = business;

// Refetch data
ref.refresh(productListProvider);

// Subscribe to changes
ref.listen(walletProvider, (prev, next) {
  // Called when wallet changes
});
```

---

## 🧪 Testing Checklist

✅ **Auth**
- [ ] Signup → token saved
- [ ] Login → redirected
- [ ] Logout → token cleared
- [ ] Token expired → redirect login

✅ **Business**
- [ ] Create → list updated
- [ ] Select → global state updated
- [ ] Update → changes reflected

✅ **Inventory**
- [ ] Add product → appears in list
- [ ] Add stock → total increases
- [ ] Multiple batches → FIFO tracked
- [ ] Spoilage → stock decreases

✅ **Sales**
- [ ] Create sale → tokens reserved
- [ ] Cash payment → stock deducted
- [ ] M-Pesa → STK triggered
- [ ] Cancel → tokens refunded

✅ **Wallet**
- [ ] Get balance → correct tokens
- [ ] Buy tokens → STK triggered
- [ ] History → transactions logged

---

## 🛠️ Common Development Tasks

### **Add New Screen**
1. Create folder: `lib/screens/feature/`
2. Create main screen file
3. Create models/providers
4. Create widgets (reusable)
5. Add route to router.dart
6. Add bottom nav item if needed

### **Add New API Endpoint**
1. Create method in corresponding API service
2. Add model class if needed
3. Create/update Riverpod provider
4. Create screen using provider
5. Add error handling
6. Test with Postman first

### **Add Validation**
1. Create validator in `lib/utils/validators.dart`
2. Use in TextFormField: `validator: (value) => validate(value)`
3. Show error message below field
4. Test with edge cases

---

## 🐛 Common Bugs & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| **Blank screen on load** | Future not resolved | Add FutureBuilder or watch provider |
| **Outdated data** | Provider not refetched | Call `ref.refresh(provider)` |
| **401 on API call** | Token expired | Implement refresh or re-login flow |
| **Wrong business data** | Using hardcoded ID | Use `selectedBusinessProvider` |
| **UI doesn't update** | State not reactive | Use StateProvider, not variable |
| **Slow list scroll** | Loading all items | Implement pagination |
| **Biometric fails** | Permission not granted | Check AndroidManifest.xml |

---

## 📝 Code Examples

### **Creating a Sale**

```dart
// 1. Add items to cart
ref.read(saleItemsProvider.notifier).state.add(SaleItem(...));

// 2. Create sale
final result = await ref.read(salesApiProvider).createSale(
  businessId: ref.watch(selectedBusinessProvider)!.id,
  items: ref.watch(saleItemsProvider),
  customerName: _nameController.text,
);

// 3. Select payment method & initiate
if (paymentMethod == 'cash') {
  await ref.read(salesApiProvider).payCash(result.id, amount);
} else {
  await ref.read(salesApiProvider).payMpesa(result.id, phone);
}

// 4. Refresh sales list
ref.refresh(salesListProvider);
```

### **Watching Wallet Balance**

```dart
final walletBuild = ref.watch(walletProvider);

return walletBuild.when(
  loading: () => CircularProgressIndicator(),
  error: (err, stack) => Text('Error: $err'),
  data: (wallet) => Column(
    children: [
      Text('${wallet.tokenBalance} tokens'),
      Text('KSH ${wallet.walletBalance}'),
    ],
  ),
);
```

### **Form Validation**

```dart
TextFormField(
  controller: _phoneController,
  validator: (value) {
    if (value == null || value.isEmpty) {
      return 'Phone required';
    }
    if (!isValidKenyanPhone(value)) {
      return 'Invalid Kenyan phone';
    }
    return null;
  },
  onChanged: (value) {
    _formKey.currentState?.validate();
  },
)
```

---

## 📚 File Structure Quick Guide

```
lib/
├── main.dart ← App entry point
├── config/
│   └── theme.dart ← Colors, typography
├── models/
│   └── *.dart ← Data classes
├── screens/
│   ├── auth/ ← Login, signup, splash
│   ├── dashboard/ ← Home screen
│   ├── inventory/ ← Products, stock
│   ├── sales/ ← Create, payment
│   ├── wallet/ ← Balance, purchase
│   └── settings/ ← User, business, security
├── services/
│   ├── api/ ← HTTP clients
│   ├── local_storage.dart ← Secure storage
│   └── biometric_service.dart ← Biometric auth
├── providers/ ← Riverpod state
├── widgets/ ← Reusable UI components
└── utils/ ← Validators, formatters, helpers
```

---

## ⏱️ Typical Dev Timeline Per Phase

| Phase | Week | Days | Hours |
|-------|------|------|-------|
| Foundation | 1 | 5 | 40 |
| Business | 1-2 | 5-7 | 40-56 |
| Inventory | 2-3 | 7 | 56 |
| Sales | 3-4 | 7 | 56 |
| Wallet & Fin | 4 | 5 | 40 |
| Polish & UX | 4-5 | 5 | 40 |
| Testing | 5 | 5 | 40 |
| **Total** | **4-5** | **27-35** | **312-328** |

---

## 🚨 Before Committing Code

```bash
# 1. Format code
flutter format lib/

# 2. Analyze
flutter analyze

# 3. Run tests
flutter test

# 4. Build (ensure no errors)
flutter build apk --release

# 5. Manual test on device
flutter run
```

---

## 📞 Debugging

```dart
// Quick logging
print('Debug: $value');  // ❌ Bad

import 'package:logger/logger.dart';
final logger = Logger();
logger.d('Debug message');  // ✅ Good

// Check Riverpod state
ref.read(provider);  // Get value
ref.watch(provider);  // Watch for changes

// Network debugging
Add: pretty_dio_logger for interceptor logging
```

---

## 🎓 Key Concepts Reference

| Concept | Definition | Example |
|---------|-----------|---------|
| **Provider** | Reactive data source | `FutureProvider<List<Product>>` |
| **StateProvider** | Mutable state | `StateProvider<Business?>` |
| **Watch** | Subscribe to changes | `ref.watch(productListProvider)` |
| **Read** | Get current value once | `ref.read(productListProvider)` |
| **Refresh** | Refetch data | `ref.refresh(productListProvider)` |
| **When** | Handle async states | `.when(loading, error, data)` |
| **Dio** | HTTP client | `final dio = Dio()` |
| **FIFO** | Stock deduction order | Oldest batches first |
| **M-Pesa STK** | Customer payment prompt | Phone → PIN → Confirm |
| **JWT** | Auth token | Stored in secure storage |

---

## ✨ Pro Tips

1. **Always use selectedBusinessProvider** for businessId (don't hardcode)
2. **Test on device early** - Emulator can hide issues
3. **Add logging everywhere** - Easier debugging later
4. **Validate input immediately** - Better UX
5. **Cache product list** - Heavy use, rarely changes
6. **Handle 401 gracefully** - Token expired, redirect login
7. **Show loading states** - Users know something is happening
8. **Test offline scenarios** - Network unstable in Kenya
9. **Use constants** - Magic numbers lead to bugs
10. **Commit daily** - Progress visible, easy rollback

---

**Happy coding! 🚀**

