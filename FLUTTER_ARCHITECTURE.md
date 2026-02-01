# Flutter Android App Architecture - PayMe Business Manager

## Project Overview

**App Name:** PayMe Business Manager  
**Platform:** Android (Flutter)  
**Target Users:** Business owners managing retail/sales operations  
**Backend:** Express.js API with JWT authentication  
**State Management:** Riverpod (modern, efficient, testable)

---

## Project Structure

```
lib/
├── main.dart                          # App entry point
├── config/
│   ├── app_constants.dart            # API URLs, timeouts, constants
│   ├── theme.dart                    # App theme (colors, typography)
│   └── routes.dart                   # Named routes configuration
├── models/
│   ├── auth/
│   │   ├── user.dart                 # User model
│   │   ├── auth_response.dart        # Login/signup responses
│   │   └── credentials.dart          # Stored user credentials
│   ├── business/
│   │   ├── business.dart             # Business profile
│   │   ├── payment_config.dart       # Payment method configuration
│   │   └── business_summary.dart     # Dashboard summary data
│   ├── inventory/
│   │   ├── product.dart              # Product model
│   │   ├── stock_batch.dart          # Stock batch with FIFO tracking
│   │   └── inventory_summary.dart    # Stock summary
│   ├── sales/
│   │   ├── sale.dart                 # Sale transaction
│   │   ├── sale_item.dart            # Individual sale item
│   │   └── payment_status.dart       # Payment states
│   ├── wallet/
│   │   ├── wallet.dart               # Wallet balance and tokens
│   │   ├── wallet_transaction.dart   # Transaction history
│   │   └── token_package.dart        # Token packages for purchase
│   ├── credit/
│   │   ├── credit_account.dart       # Customer credit account
│   │   └── credit_transaction.dart   # Credit transaction
│   ├── higher_purchase/
│   │   ├── hire_purchase_agreement.dart  # HP agreement
│   │   └── hp_payment.dart               # Payment towards agreement
│   ├── spoiled_stock/
│   │   └── spoilage.dart             # Spoilage record
│   ├── expense/
│   │   └── expense.dart              # Business expense
│   └── records/
│       └── record.dart               # Business record
├── services/
│   ├── api/
│   │   ├── api_client.dart           # Dio HTTP client with interceptors
│   │   ├── auth_api.dart             # Auth endpoints
│   │   ├── business_api.dart         # Business CRUD
│   │   ├── stock_api.dart            # Inventory management
│   │   ├── sales_api.dart            # Sales operations
│   │   ├── wallet_api.dart           # Wallet & token purchases
│   │   ├── credit_api.dart           # Credit management
│   │   ├── hp_api.dart               # Hire purchase operations
│   │   ├── expense_api.dart          # Expense tracking
│   │   ├── spoilage_api.dart         # Spoilage recording
│   │   └── payment_config_api.dart   # Payment method configuration
│   ├── local_storage.dart            # Secure token & credential storage
│   └── biometric_service.dart        # Fingerprint/face authentication
├── providers/
│   ├── auth_provider.dart            # Auth state (login, signup, logout)
│   ├── user_provider.dart            # Current user data
│   ├── business_provider.dart        # Selected business & list
│   ├── inventory_provider.dart       # Stock/product management
│   ├── sales_provider.dart           # Sales history & current sale
│   ├── wallet_provider.dart          # Wallet balance & transactions
│   ├── credit_provider.dart          # Credit accounts
│   ├── hp_provider.dart              # Hire purchase agreements
│   ├── expense_provider.dart         # Expense list & summary
│   ├── spoilage_provider.dart        # Spoilage records
│   └── notification_provider.dart    # Notifications & alerts
├── screens/
│   ├── auth/
│   │   ├── splash_screen.dart        # App startup check
│   │   ├── login_screen.dart         # Email + password login
│   │   ├── signup_screen.dart        # User registration
│   │   ├── setup_screen.dart         # Post-signup: create business
│   │   └── biometric_screen.dart     # Biometric auth setup & login
│   ├── dashboard/
│   │   └── dashboard_screen.dart     # Home: quick stats, actions
│   ├── business/
│   │   ├── business_list_screen.dart # View all businesses
│   │   ├── business_detail_screen.dart # Business settings, edit
│   │   ├── payment_setup_screen.dart # Configure payment method
│   │   └── business_selector.dart    # Floating button to switch business
│   ├── inventory/
│   │   ├── inventory_screen.dart     # Product list
│   │   ├── add_product_screen.dart   # Create new product
│   │   ├── add_stock_screen.dart     # Add stock to product
│   │   ├── spoilage_screen.dart      # Record spoiled items
│   │   └── stock_analytics.dart      # Stock summary & insights
│   ├── sales/
│   │   ├── sales_list_screen.dart    # Sales history
│   │   ├── create_sale_screen.dart   # New sale (add items)
│   │   ├── sale_detail_screen.dart   # View sale, payment options
│   │   ├── payment_screen.dart       # Cash or M-Pesa payment UI
│   │   └── sales_analytics.dart      # Revenue, trends
│   ├── wallet/
│   │   ├── wallet_screen.dart        # Balance, packages, history
│   │   ├── purchase_tokens_screen.dart # Buy tokens (STK push)
│   │   └── transactions_screen.dart  # Transaction history
│   ├── credit/
│   │   ├── credit_list_screen.dart   # Customers with credit
│   │   ├── create_credit_screen.dart # New credit account
│   │   ├── credit_detail_screen.dart # View/manage account
│   │   └── credit_analytics.dart     # Credit summary
│   ├── higher_purchase/
│   │   ├── hp_list_screen.dart       # Active HP agreements
│   │   ├── create_hp_screen.dart     # New agreement
│   │   ├── hp_detail_screen.dart     # Agreement details
│   │   ├── hp_payment_screen.dart    # Record HP payment
│   │   └── hp_analytics.dart         # Summary & upcoming payments
│   ├── settings/
│   │   ├── settings_screen.dart      # Main settings
│   │   ├── profile_screen.dart       # User profile edit
│   │   ├── business_settings.dart    # Business name, location, payment
│   │   ├── security_screen.dart      # Password, biometric, session
│   │   ├── wallet_settings.dart      # Wallet in settings (as per requirement)
│   │   └── about_screen.dart         # App info, version
│   └── shared/
│       ├── bottom_nav.dart           # Bottom navigation bar
│       ├── app_drawer.dart           # Side drawer navigation
│       └── error_screen.dart         # Error state UI
├── widgets/
│   ├── common/
│   │   ├── app_button.dart           # Reusable button
│   │   ├── app_text_field.dart       # Input field with validation
│   │   ├── app_loader.dart           # Loading indicator
│   │   ├── app_error.dart            # Error message widget
│   │   └── empty_state.dart          # No data UI
│   ├── business/
│   │   ├── business_card.dart        # Business card widget
│   │   └── business_selector.dart    # Business picker
│   ├── sales/
│   │   ├── sale_item_card.dart       # Sale line item
│   │   ├── payment_method_picker.dart # Cash vs M-Pesa
│   │   └── stk_push_dialog.dart      # M-Pesa STK dialog
│   ├── inventory/
│   │   ├── product_card.dart         # Product display
│   │   └── stock_status_badge.dart   # Low stock warning
│   └── credit/
│       ├── credit_card.dart          # Customer credit summary
│       └── credit_status_badge.dart  # Payment status
├── utils/
│   ├── validators.dart               # Form validation logic
│   ├── formatters.dart               # Date, currency, phone formatting
│   ├── extensions.dart               # String, DateTime extensions
│   ├── error_handler.dart            # API error parsing
│   ├── logger.dart                   # App logging
│   └── helpers.dart                  # Utility functions
└── exceptions/
    ├── api_exception.dart            # API error types
    ├── auth_exception.dart           # Auth-specific errors
    └── validation_exception.dart     # Validation errors
```

---

## Core Features & Navigation

### **1. Authentication Flow**

**Login Path:**
1. **Splash Screen** → Checks stored token → Routes to Login or Dashboard
2. **Login Screen** → Email + Password → JWT token stored
3. **Biometric Setup** (Optional) → Setup fingerprint/face for faster login
4. **Dashboard** → Home with quick actions

**Signup Path:**
1. **Signup Screen** → Name, Phone, Email, Password (Kenyan phone validation)
2. **Payment Setup Screen** → Configure first business (till/paybill/wallet)
3. **Dashboard** → Ready to use

### **2. Bottom Navigation (5 Tabs)**

```
┌─────────────────────────────────────┐
│  Dashboard  │ Inventory │ Sales │ Credit │ Settings │
└─────────────────────────────────────┘
```

- **Dashboard**: Quick stats, recent sales, wallet balance, action buttons
- **Inventory**: Products, add stock, spoilage tracking
- **Sales**: Create sale, payment (cash/M-Pesa), history
- **Credit**: Customer credit accounts, payments, analytics
- **Settings**: Business profile, payment method, user profile, wallet, security

### **3. Business Switching**

- **Floating Action Button** (accessible everywhere) to switch active business
- Selected business persists across app sessions
- All operations scoped to selected business

### **4. Wallet Integration**

- Integrated into **Settings** (not main dashboard tab)
- View balance, transaction history, buy tokens
- Token packages display with discounts
- STK push initiated directly in-app

---

## State Management with Riverpod

### **Provider Structure**

```dart
// Auth State
final authProvider = StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier(ref.watch(apiClient)));

// Business State
final businessListProvider = FutureProvider<List<Business>>((ref) {
  final api = ref.watch(businessApiProvider);
  return api.getBusinesses();
});

final selectedBusinessProvider = StateProvider<Business?>((ref) => null);

// Inventory State
final productListProvider = FutureProvider<List<Product>>((ref) {
  final api = ref.watch(stockApiProvider);
  final businessId = ref.watch(selectedBusinessProvider)?.id;
  return api.getProducts(businessId!);
});

// Sales State
final saleItemsProvider = StateProvider<List<SaleItem>>((ref) => []);

// Wallet State
final walletProvider = FutureProvider<Wallet>((ref) {
  final api = ref.watch(walletApiProvider);
  final businessId = ref.watch(selectedBusinessProvider)?.id;
  return api.getWallet(businessId!);
});
```

### **Why Riverpod?**

- ✅ Automatic dependency tracking
- ✅ Powerful caching & refetching
- ✅ Side effects handled cleanly
- ✅ Easy testing (no singletons)
- ✅ Flutter/Dart native

---

## API Service Layer

### **API Client (Dio)**

```dart
class ApiClient {
  final Dio _dio;
  final LocalStorage _localStorage;

  ApiClient(this._localStorage) : _dio = Dio() {
    _dio.options.baseUrl = AppConstants.baseUrl;
    _dio.options.connectTimeout = const Duration(seconds: 10);
    
    // Interceptor: Add JWT token to requests
    _dio.interceptors.add(InterceptorsWrapper(
      onRequest: (options, handler) async {
        final token = await _localStorage.getToken();
        if (token != null) {
          options.headers['Authorization'] = 'Bearer $token';
        }
        return handler.next(options);
      },
      onError: (error, handler) {
        if (error.response?.statusCode == 401) {
          // Handle token expiration - show login
        }
        return handler.next(error);
      },
    ));
  }
}
```

### **Key API Services**

| Service | Endpoints | Methods |
|---------|-----------|---------|
| **Auth API** | `/api/auth` | signup, signin, signout |
| **Business API** | `/api/businesses`, `/api/setting` | list, create, get, update |
| **Stock API** | `/api/stock` | products (CRUD), add stock, inventory, adjustments |
| **Sales API** | `/api/sales`, `/api/payme` | create, list, pay (cash/M-Pesa), cancel |
| **Wallet API** | `/api/wallet`, `/api/myWallet` | balance, packages, purchase, transactions |
| **Credit API** | `/api/credit` | create account, list, update, transactions |
| **HP API** | `/api/higher-purchase` | create, list, payment, analytics |
| **Expense API** | `/api/expense` | record, list, summary, analytics |
| **Spoilage API** | `/api/spoiled-stock` | record, list, summary, update |
| **Payment Config** | `/api/payment-config` | setup, get, update, toggle |

---

## Key Screens & User Flows

### **1. Login → Dashboard Flow**

```
Splash
  ↓ (check token)
  ├→ Login Screen (if no token)
  │   ├→ Email + Password
  │   ├→ Biometric Setup (optional)
  │   └→ Dashboard
  │
  └→ Dashboard (if token valid)
      ├→ Biometric Option on Settings
      └→ Select Business (if multiple)
```

### **2. Create Sale Flow**

```
Dashboard
  ↓
Create Sale (+ button)
  ↓
Add Items (select product, quantity)
  ↓
Preview Sale (total, items list)
  ↓
Select Payment (Cash / M-Pesa)
  │
  ├→ Cash: Confirm → Deduct Stock → Complete
  │
  └→ M-Pesa: STK Push → Customer enters PIN → Callback → Stock deducted
```

### **3. Manage Stock Flow**

```
Inventory Tab
  ↓
View Products (list)
  ├→ Tap Product: View stock, add stock, record spoilage
  │   ├→ Add Stock: Enter batch cost, quantity → Saved (FIFO tracking)
  │   └→ Record Spoilage: Select quantity → Recorded
  │
  └→ + Button: Create new product
```

### **4. Business Settings Flow**

```
Settings Tab
  ↓
Business Settings
  ├→ Edit Name, Location
  ├→ Configure Payment Method (till/paybill/wallet)
  ├→ Wallet (balance, buy tokens, history)
  ├→ View linked businesses
  └→ Switch business (via business selector elsewhere)
```

---

## Backend API Integration Checklist

### **Endpoints to Integrate**

#### **Authentication**
- [ ] `POST /api/auth/sign-up` - Register business owner
- [ ] `POST /api/auth/sign-in` - Login
- [ ] `POST /api/auth/sign-out` - Logout

#### **Businesses**
- [ ] `POST /api/businesses` - Create business
- [ ] `GET /api/businesses` - List user's businesses
- [ ] `GET /api/businesses/:id` - Get business details
- [ ] `PUT /api/businesses/:id` - Update business

#### **Payment Configuration**
- [ ] `POST /api/payment-config/setup` - Setup payment method
- [ ] `GET /api/payment-config/:businessId` - Get config
- [ ] `PATCH /api/payment-config/:configId` - Update config
- [ ] `POST /api/payment-config/:configId/toggle` - Enable/disable

#### **Inventory**
- [ ] `POST /api/stock/products` - Create product
- [ ] `GET /api/stock/products/business/:businessId` - List products
- [ ] `GET /api/stock/inventory/business/:businessId` - Get inventory
- [ ] `POST /api/stock/add` - Add stock batch (FIFO)
- [ ] `POST /api/stock/adjustment` - Stock adjustment

#### **Sales**
- [ ] `POST /api/sales` - Create sale
- [ ] `GET /api/sales/business/:businessId` - List sales
- [ ] `GET /api/sales/:id` - Get sale details
- [ ] `POST /api/sales/:id/pay/cash` - Pay with cash
- [ ] `POST /api/sales/:id/pay/mpesa` - Pay with M-Pesa (STK push)
- [ ] `POST /api/sales/:id/cancel` - Cancel sale

#### **Wallet**
- [ ] `GET /api/wallet/business/:businessId` - Get balance
- [ ] `GET /api/wallet/packages` - Get token packages
- [ ] `POST /api/wallet/purchase` - Purchase tokens (STK push)
- [ ] `GET /api/wallet/business/:businessId/transactions` - Transaction history

#### **Credit**
- [ ] `POST /api/credit` - Create credit account
- [ ] `GET /api/credit/accounts` - List credit accounts
- [ ] `GET /api/credit/accounts/:accountId` - Get account details
- [ ] `PATCH /api/credit/accounts/:accountId` - Update account

#### **Hire Purchase**
- [ ] `POST /api/higher-purchase/:businessId/create` - Create agreement
- [ ] `GET /api/higher-purchase/:businessId` - List agreements
- [ ] `GET /api/higher-purchase/:businessId/:agreementId` - Get agreement
- [ ] `POST /api/higher-purchase/:businessId/:agreementId/payment` - Record payment

#### **Expenses**
- [ ] `POST /api/expense/:businessId/record` - Record expense
- [ ] `GET /api/expense/:businessId` - List expenses
- [ ] `GET /api/expense/:businessId/summary` - Expense summary

#### **Spoilage**
- [ ] `POST /api/spoiled-stock` - Record spoilage
- [ ] `GET /api/spoiled-stock/:businessId` - List spoilage

---

## Data Models (Dart Classes)

### **Core Models Example**

```dart
// User Model
class User {
  final int id;
  final String name;
  final String phoneNumber;
  final String email;
  final String role; // 'user' or 'admin'
  final DateTime createdAt;
  
  User({
    required this.id,
    required this.name,
    required this.phoneNumber,
    required this.email,
    required this.role,
    required this.createdAt,
  });
  
  factory User.fromJson(Map<String, dynamic> json) => User(
    id: json['id'],
    name: json['name'],
    phoneNumber: json['phone_number'],
    email: json['email'],
    role: json['role'],
    createdAt: DateTime.parse(json['created_at']),
  );
}

// Business Model
class Business {
  final int id;
  final String name;
  final String location;
  final String? locationDescription;
  final String paymentMethod; // 'till_number', 'paybill', 'wallet'
  final String paymentIdentifier;
  final bool verified;
  final DateTime createdAt;
  
  Business({/* ... */});
  
  factory Business.fromJson(Map<String, dynamic> json) => Business(/* ... */);
}

// Product Model
class Product {
  final int id;
  final int businessId;
  final String name;
  final double basePrice;
  final int currentStock;
  final int lowStockThreshold;
  final DateTime createdAt;
  
  Product({/* ... */});
  
  factory Product.fromJson(Map<String, dynamic> json) => Product(/* ... */);
}

// Sale Model
class Sale {
  final int id;
  final int businessId;
  final List<SaleItem> items;
  final double totalAmount;
  final String paymentStatus; // 'pending', 'completed', 'cancelled'
  final String paymentMethod; // 'cash', 'm-pesa'
  final DateTime createdAt;
  
  Sale({/* ... */});
  
  factory Sale.fromJson(Map<String, dynamic> json) => Sale(/* ... */);
}

// Wallet Model
class Wallet {
  final int id;
  final int businessId;
  final int tokenBalance;
  final double walletBalance;
  final DateTime lastUpdated;
  
  Wallet({/* ... */});
  
  factory Wallet.fromJson(Map<String, dynamic> json) => Wallet(/* ... */);
}
```

---

## Authentication & Security

### **JWT Token Handling**

```dart
class LocalStorage {
  final FlutterSecureStorage _storage;
  
  // Store token after login
  Future<void> saveToken(String token) async {
    await _storage.write(key: 'jwt_token', value: token);
  }
  
  // Retrieve token for requests
  Future<String?> getToken() async {
    return await _storage.read(key: 'jwt_token');
  }
  
  // Clear token on logout
  Future<void> clearToken() async {
    await _storage.delete(key: 'jwt_token');
  }
}
```

### **Biometric Authentication**

```dart
class BiometricService {
  final LocalAuthentication _localAuth;
  
  Future<bool> canUseBiometrics() async {
    return await _localAuth.canCheckBiometrics;
  }
  
  Future<bool> authenticate() async {
    try {
      return await _localAuth.authenticate(
        localizedReason: 'Authenticate to access PayMe',
        options: const AuthenticationOptions(stickyAuth: true),
      );
    } catch (e) {
      return false;
    }
  }
}
```

---

## Implementation Priorities

### **Phase 1: Core Setup** (Week 1)
1. Project structure & theme
2. Auth screens (login, signup)
3. JWT token handling & secure storage
4. Dashboard stub

### **Phase 2: Business Management** (Week 2)
5. Business CRUD screens
6. Business switching
7. Payment configuration

### **Phase 3: Inventory** (Week 2-3)
8. Product list & management
9. Add stock (FIFO)
10. Spoilage tracking
11. Stock analytics

### **Phase 4: Sales** (Week 3)
12. Create sale flow
13. Cash payment completion
14. M-Pesa STK push integration
15. Sales history

### **Phase 5: Financial** (Week 4)
16. Wallet & token purchase
17. Credit management
18. Hire purchase
19. Expense tracking

### **Phase 6: Polish** (Week 4-5)
20. Biometric login
21. Settings & user profile
22. Error handling & validation
23. Testing & optimization

---

## Development Dependencies

```yaml
dependencies:
  flutter:
    sdk: flutter
  
  # State Management
  riverpod: ^latest
  flutter_riverpod: ^latest
  
  # HTTP & Serialization
  dio: ^latest
  pretty_dio_logger: ^latest
  
  # Local Storage
  flutter_secure_storage: ^latest
  shared_preferences: ^latest
  hive: ^latest
  
  # Biometric
  local_auth: ^latest
  
  # Validation
  email_validator: ^latest
  
  # UI
  flutter_svg: ^latest
  cached_network_image: ^latest
  intl: ^latest
  
  # Logging
  logger: ^latest
  
  # Utilities
  uuid: ^latest
  equatable: ^latest

dev_dependencies:
  flutter_test:
    sdk: flutter
  riverpod_generator: ^latest
  build_runner: ^latest
```

---

## Error Handling Strategy

```dart
class ApiException implements Exception {
  final String message;
  final int? statusCode;
  final dynamic originalError;
  
  ApiException({
    required this.message,
    this.statusCode,
    this.originalError,
  });
  
  factory ApiException.fromDioError(DioException error) {
    String message = 'An error occurred';
    
    if (error.response?.statusCode == 401) {
      message = 'Unauthorized - please login again';
    } else if (error.response?.statusCode == 400) {
      message = error.response?.data['error'] ?? 'Bad request';
    } else if (error.type == DioExceptionType.connectionTimeout) {
      message = 'Connection timeout';
    }
    
    return ApiException(
      message: message,
      statusCode: error.response?.statusCode,
      originalError: error,
    );
  }
}
```

---

## Next Steps

1. **Backend Analysis**: Identify missing endpoints or incomplete features
2. **Project Generation**: Create Flutter project with dependencies
3. **Models Implementation**: Define all data classes with serialization
4. **API Services**: Implement all API clients with error handling
5. **Providers**: Setup Riverpod state management
6. **UI Implementation**: Build screens in priority order
7. **Testing**: Unit tests for models, API integration tests

---

**Notes:**
- App uses **Kenyan phone number validation** (0XXXXXXXXX or +254XXXXXXXXX)
- Business owner = User account (separate from individual customer profiles)
- Wallet integration sits in Settings alongside business profile (not standalone)
- All operations are business-scoped (multi-tenant aware)
- M-Pesa STK push handled in-app with real-time payment status
- FIFO stock deduction ensures accurate profit calculation

