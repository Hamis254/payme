/**
 * ANALYTICS INTEGRATION EXAMPLE
 * 
 * Real-world examples of using the analytics endpoints
 * in your frontend or backend code
 * 
 * Copy and adapt these to your needs!
 * 
 * Note: This file contains example code strings (not meant to be executed)
 * ESLint is disabled for this file
 */
/* eslint-disable */

// ============================================================================
// EXAMPLE 1: Flutter - Get Dashboard Data for UI
// ============================================================================

/**
 * Flutter code example using Dio
 */
const flutterExample = `
import 'package:dio/dio.dart';

// Setup
final dio = Dio();
const baseUrl = 'http://api.payme.local';
final businessId = 1;
final token = 'your_jwt_token';

// Get dashboard data
Future<Map> getDashboard() async {
  try {
    final response = await dio.get(
      '$baseUrl/api/analytics/$businessId/dashboard',
      queryParameters: {'period': 'daily'},
      options: Options(
        headers: {'Authorization': 'Bearer $token'},
      ),
    );
    
    final dashboard = response.data['data'];
    
    // Extract metrics
    final revenue = dashboard['summary']['totalRevenue'];
    final profit = dashboard['summary']['totalProfit'];
    final margin = dashboard['summary']['profitMargin'];
    final transactions = dashboard['summary']['transactionCount'];
    
    // Get top products
    final topProducts = dashboard['topProducts']['byProfit'];
    
    // Get inventory
    final inventory = dashboard['inventory'];
    
    return dashboard;
  } on DioException catch (e) {
    print('Error: ${e.message}');
  }
}

// Show in UI
void displayDashboard() async {
  final dashboard = await getDashboard();
  
  // Update KPI cards
  revenueCard.text = 'KES ${dashboard['summary']['totalRevenue']}';
  profitCard.text = 'KES ${dashboard['summary']['totalProfit']}';
  marginCard.text = '${dashboard['summary']['profitMargin']}%';
  
  // Update top products list
  for (var product in dashboard['topProducts']['byProfit']) {
    productsList.add(
      ProductCard(
        name: product['productName'],
        profit: product['totalProfit'],
        revenue: product['totalRevenue'],
      ),
    );
  }
}
`;

// ============================================================================
// EXAMPLE 2: React/JavaScript - Dashboard Component
// ============================================================================

const reactExample = `
import axios from 'axios';
import { LineChart, BarChart, PieChart } from 'recharts';

export function AnalyticsDashboard({ businessId, token }) {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const response = await axios.get(
        \`/api/analytics/\${businessId}/dashboard?period=daily\`,
        { headers: { Authorization: \`Bearer \${token}\` } }
      );
      
      setDashboard(response.data.data);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    }
  };

  if (loading) return <div>Loading...</div>;

  const summary = dashboard.summary;
  const trend = dashboard.salesTrend || [];
  const topProducts = dashboard.topProducts.byProfit;

  return (
    <div className="dashboard">
      {/* KPI Cards */}
      <div className="kpi-row">
        <KpiCard label="Revenue" value={\`KES \${summary.totalRevenue}\`} />
        <KpiCard label="Profit" value={\`KES \${summary.totalProfit}\`} />
        <KpiCard label="Margin" value={\`\${summary.profitMargin}%\`} />
        <KpiCard label="Transactions" value={summary.transactionCount} />
      </div>

      {/* Charts */}
      <div className="charts-row">
        <LineChart width={600} height={300} data={trend}>
          <CartesianGrid />
          <Tooltip />
          <Line type="monotone" dataKey="totalRevenue" stroke="#8884d8" />
        </LineChart>

        <BarChart width={600} height={300} data={topProducts}>
          <CartesianGrid />
          <Tooltip />
          <Bar dataKey="totalProfit" fill="#82ca9d" />
        </BarChart>
      </div>

      {/* Top Products Table */}
      <div className="table">
        <h2>Top Products by Profit</h2>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Revenue</th>
              <th>Profit</th>
              <th>Units</th>
            </tr>
          </thead>
          <tbody>
            {topProducts.map(p => (
              <tr key={p.productId}>
                <td>{p.productName}</td>
                <td>KES {p.totalRevenue}</td>
                <td>KES {p.totalProfit}</td>
                <td>{p.unitsSold}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
`;

// ============================================================================
// EXAMPLE 3: Backend Node.js - Fetch Analytics for Export
// ============================================================================

const nodeBackendExample = `
import axios from 'axios';

async function generateMonthlyReport(businessId, token) {
  try {
    // Get monthly dashboard data
    const dashboard = await axios.get(
      \`/api/analytics/\${businessId}/dashboard?period=monthly\`,
      { headers: { Authorization: \`Bearer \${token}\` } }
    );

    const summary = dashboard.data.data.summary;
    const topProducts = dashboard.data.data.topProducts.byProfit;
    const expenses = dashboard.data.data.expenses;

    // Format for PDF/email
    const report = {
      title: 'Monthly Business Report',
      period: 'February 2026',
      metrics: {
        totalRevenue: summary.totalRevenue,
        totalProfit: summary.totalProfit,
        profitMargin: summary.profitMargin,
        transactions: summary.transactionCount,
      },
      topProducts: topProducts.slice(0, 5).map(p => ({
        name: p.productName,
        revenue: p.totalRevenue,
        profit: p.totalProfit,
        margin: ((p.totalProfit / p.totalRevenue) * 100).toFixed(2) + '%',
      })),
      expenses: {
        total: expenses.totalExpenses,
        byCategory: expenses.byCategory,
      },
    };

    return report;
  } catch (error) {
    console.error('Report generation failed:', error);
  }
}

// Usage
const report = await generateMonthlyReport(1, token);
sendEmailReport(owner.email, report); // Send to owner
`;

// ============================================================================
// EXAMPLE 4: Caching - Refresh Analytics Cache on Schedule
// ============================================================================

const cachingExample = `
import cron from 'node-cron';
import analyticsService from '#services/analytics.service.js';

/**
 * Refresh analytics cache every hour
 * Improves dashboard load times (0.1s instead of 0.3s)
 */
cron.schedule('0 * * * *', async () => {
  try {
    // Get all active businesses
    const businesses = await db.select().from(businesses).limit(1000);

    // Refresh cache for each
    for (const business of businesses) {
      await analyticsService.refreshAnalyticsCache(business.id, 'daily');
      await analyticsService.refreshAnalyticsCache(business.id, 'weekly');
      await analyticsService.refreshAnalyticsCache(business.id, 'monthly');
    }

    console.log(\`Analytics cache refreshed for \${businesses.length} businesses\`);
  } catch (error) {
    console.error('Cache refresh failed:', error);
  }
});
`;

// ============================================================================
// EXAMPLE 5: Alerts - Trigger Notification on Metrics
// ============================================================================

const alertsExample = `
import analyticsService from '#services/analytics.service.js';
import { emitNotification } from '#utils/notificationEmitter.js';

/**
 * Check business health every hour
 * Send alerts if something is wrong
 */
cron.schedule('0 * * * *', async () => {
  const businesses = await db.select().from(businesses);

  for (const business of businesses) {
    // Get today's metrics
    const summary = await analyticsService.getDashboardData(business.id, 'daily');
    
    // Check if revenue is low (less than half of yesterday)
    const yesterday = await analyticsService.getDashboardData(
      business.id,
      'daily',
      DateUtils.yesterday()
    );

    if (summary.summary.totalRevenue < yesterday.summary.totalRevenue * 0.5) {
      // Alert owner
      await emitNotification({
        user_id: business.user_id,
        type: 'lowRevenue',
        title: 'Low Sales Today',
        message: \`Today's sales (KES \${summary.summary.totalRevenue}) are 50% lower than yesterday\`,
        channel: 'sms',
      });
    }

    // Check inventory value
    if (summary.inventory.totalCostValue > 500000) {
      // Alert for overstocking
      await emitNotification({
        user_id: business.user_id,
        type: 'highInventory',
        title: 'High Stock Levels',
        message: \`Your inventory value is KES \${summary.inventory.totalCostValue}. Consider reducing stock.\`,
        channel: 'email',
      });
    }

    // Check profit margin
    if (summary.summary.profitMargin < 20) {
      await emitNotification({
        user_id: business.user_id,
        type: 'lowMargin',
        title: 'Low Profit Margin',
        message: \`Profit margin is \${summary.summary.profitMargin}%. Target is 25%+.\`,
        channel: 'in_app',
      });
    }
  }
});
`;

// ============================================================================
// EXAMPLE 6: API Testing with Curl
// ============================================================================

const curlExamples = `
#!/bin/bash

# Set your business ID and JWT token
BUSINESS_ID=1
JWT_TOKEN="your_jwt_token_here"
API_URL="http://localhost:3000/api/analytics"

# 1. Get Today's Summary
echo "📊 Getting today's summary..."
curl -X GET "$API_URL/$BUSINESS_ID/summary?period=daily" \\
  -H "Authorization: Bearer $JWT_TOKEN" \\
  -H "Content-Type: application/json" | jq

# 2. Get This Week's Dashboard
echo "📈 Getting this week's dashboard..."
curl -X GET "$API_URL/$BUSINESS_ID/dashboard?period=weekly" \\
  -H "Authorization: Bearer $JWT_TOKEN" | jq

# 3. Get Top 5 Most Profitable Products
echo "🏆 Top products by profit..."
curl -X GET "$API_URL/$BUSINESS_ID/top-products?sortBy=profit&limit=5" \\
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.data.products'

# 4. Get Revenue Breakdown
echo "💰 Revenue breakdown..."
curl -X GET "$API_URL/$BUSINESS_ID/revenue-breakdown?period=monthly" \\
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.data'

# 5. Get 30-Day Sales Trend
echo "📉 Sales trend..."
curl -X GET "$API_URL/$BUSINESS_ID/sales-trend?daysBack=30" \\
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.data.trend'

# 6. Get Inventory Value
echo "📦 Inventory..."
curl -X GET "$API_URL/$BUSINESS_ID/inventory" \\
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.data'

# 7. Get Customer Stats
echo "👥 Customer statistics..."
curl -X GET "$API_URL/$BUSINESS_ID/customers?period=monthly" \\
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.data'

# 8. Get Expense Breakdown
echo "💸 Expenses..."
curl -X GET "$API_URL/$BUSINESS_ID/expenses?period=monthly" \\
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.data.byCategory'
`;

// ============================================================================
// EXAMPLE 7: Error Handling
// ============================================================================

const errorHandlingExample = `
async function safeGetAnalytics(businessId, token) {
  try {
    const response = await axios.get(
      \`/api/analytics/\${businessId}/summary\`,
      {
        headers: { Authorization: \`Bearer \${token}\` },
        timeout: 5000, // 5 second timeout
      }
    );

    return response.data.data;
  } catch (error) {
    if (error.response?.status === 401) {
      // Token expired - refresh and retry
      console.log('Token expired, refreshing...');
      token = await refreshToken();
      return safeGetAnalytics(businessId, token);
    } else if (error.response?.status === 403) {
      // User doesn't own this business
      console.error('Access denied to this business');
      throw new Error('Unauthorized');
    } else if (error.response?.status === 400) {
      // Invalid parameters
      console.error('Invalid parameters:', error.response.data.details);
      throw new Error('Invalid request');
    } else if (error.code === 'ECONNABORTED') {
      // Request timeout
      console.error('Request timed out');
      throw new Error('Server too slow');
    } else {
      // Unknown error
      console.error('Unexpected error:', error);
      throw error;
    }
  }
}
`;

// ============================================================================
// EXAMPLE 8: Data Transformation for Charts
// ============================================================================

const chartTransformExample = `
/**
 * Transform API response into chart-ready format
 */

function transformToLineChartData(salesTrend) {
  return salesTrend.map(day => ({
    date: day.date,
    revenue: parseFloat(day.totalRevenue),
    profit: parseFloat(day.totalProfit),
  }));
}

function transformToBarChartData(topProducts) {
  return topProducts.map(p => ({
    name: p.productName,
    value: parseFloat(p.totalProfit),
    fullLabel: \`\${p.productName} (KES \${p.totalRevenue})\`,
  }));
}

function transformToPieChartData(revenueBreakdown) {
  return revenueBreakdown.byPaymentMethod.map(item => ({
    name: item.paymentMethod === 'cash' ? 'Cash' : 'M-Pesa',
    value: parseFloat(item.totalRevenue),
    count: item.transactionCount,
  }));
}

// Usage
const lineData = transformToLineChartData(dashboard.salesTrend);
const barData = transformToBarChartData(dashboard.topProducts.byProfit);
const pieData = transformToPieChartData(dashboard.breakdown);
`;

// ============================================================================
// EXPORT ALL EXAMPLES
// ============================================================================

const examples = {
  flutterExample,
  reactExample,
  nodeBackendExample,
  cachingExample,
  alertsExample,
  curlExamples,
  errorHandlingExample,
  chartTransformExample,
};

console.log('✅ Analytics Integration Examples Ready');
console.log('');
console.log('Copy-paste these into your codebase:');
console.log('  1. Flutter dashboard UI');
console.log('  2. React dashboard component');
console.log('  3. Node.js backend report generation');
console.log('  4. Caching/refresh job');
console.log('  5. Business alerts/notifications');
console.log('  6. API testing with curl');
console.log('  7. Error handling patterns');
console.log('  8. Data transformation for charts');
console.log('');
console.log('See ANALYTICS_QUICK_REFERENCE.md for endpoint details');
console.log('See ANALYTICS_COMPLETE.md for full API reference');

export default examples;
