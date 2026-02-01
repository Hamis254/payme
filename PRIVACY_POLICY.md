# PayMe Privacy Policy

**Version**: 1.0  
**Effective Date**: January 28, 2026  
**Last Updated**: January 28, 2026  

---

## 1. Introduction & Purpose

**PayMe** ("we," "us," "our," or "Company") respects your privacy and is committed to protecting your personal data. This Privacy Policy explains how we collect, use, store, and protect information about you in accordance with:

- **Kenya Data Protection Act, 2019** (DPA)
- **Kenya Constitution, 2010** (Right to Privacy - Article 31)
- **Electronic Transactions and Cybercrimes Act, 2013**
- **International Best Practices**: GDPR, ISO 27001

This policy applies to all users of the PayMe platform, including merchants, customers, and partners.

---

## 2. Who We Are

**PayMe Limited**  
A fintech platform providing business management and payment solutions for merchants in Kenya.

**Contact Information**:
- Email: privacy@payme.co.ke
- Website: https://payme.co.ke
- Address: [Your Business Address], Nairobi, Kenya

**Data Protection Officer**:
- Email: dpo@payme.co.ke
- Phone: [Your Phone Number]

**Kenya Data Protection Commissioner**:
- Email: complaints@dpa.go.ke
- Website: https://www.dpa.go.ke

---

## 3. What Personal Data We Collect

### 3.1 Data You Provide Directly

**Account Registration**:
- Full name
- Email address
- Phone number (encrypted at rest)
- Password (hashed with bcrypt)
- Business name
- Business location (town/city)
- Business type (retail, services, etc.)

**Payment Information**:
- M-Pesa phone number (for payments)
- Till number or Paybill account (business)
- Bank account details (encrypted)
- Payment method preferences

**Identity & Compliance**:
- National ID number (encrypted at rest)
- KRA PIN (Tax Compliance)
- Business registration number

**Business Data**:
- Product catalog & pricing
- Stock/inventory records
- Sales transactions
- Customer names (from sales)
- Customer phone numbers (from M-Pesa)

**Customer Support**:
- Support tickets & messages
- File uploads (receipts, documents)
- Communication logs

### 3.2 Data Collected Automatically

**System Access Data**:
- IP address
- Device type & operating system
- Browser type & version
- Login timestamps
- Logout timestamps
- Session duration
- Geographic location (approximate, from IP)

**Transaction Data**:
- Sale timestamps
- Amount transferred
- Payment method used
- M-Pesa transaction reference
- Delivery status (if applicable)

**Security Data**:
- Failed login attempts
- Rate limiting events
- Firewall blocks
- Security alert triggers

**Performance Data**:
- Page load times
- API response times
- Error rates
- Feature usage statistics

---

## 4. How We Use Your Data

### 4.1 Essential Service Delivery

**To Operate PayMe**:
- Process transactions and payments
- Generate financial statements & reports
- Manage inventory & stock
- Track sales and revenue
- Process customer refunds
- Manage wallet & token systems

**Account Management**:
- Create and maintain your account
- Authenticate users
- Reset passwords
- Verify email/phone
- Enforce role-based access

**Payment Processing**:
- Initiate M-Pesa payments
- Receive payment callbacks
- Reconcile transactions
- Generate payment receipts
- Track payment status

### 4.2 Compliance & Legal

**Regulatory Compliance**:
- Kenya Revenue Authority (KRA) tax reporting
- Anti-Money Laundering (AML) checks
- Know Your Customer (KYC) verification
- Business registration validation
- Financial transaction monitoring

**Legal Obligations**:
- Respond to court orders
- Comply with government requests
- Fraud investigation
- Dispute resolution
- Contractual obligations

**Data Protection**:
- Maintaining audit logs (KDPA Article 8)
- Ensuring accountability (KDPA Article 5)
- Breach notification (KDPA Article 40)
- Rights fulfillment (KDPA Articles 8-10)

### 4.3 Service Improvement

**Analytics & Insights**:
- Analyze usage patterns
- Identify feature demand
- Improve user experience
- Optimize app performance
- Identify bugs & errors
- A/B testing (with consent)

**Business Intelligence**:
- Aggregate sales trends
- Regional market analysis
- Product performance metrics
- Pricing optimization
- Inventory forecasting

### 4.4 Security & Fraud Prevention

**Protecting Your Account**:
- Detect unauthorized access attempts
- Prevent brute force attacks
- Rate limiting on suspicious IPs
- Anomaly detection
- Idempotency key tracking (prevent duplicate charges)

**Protecting PayMe**:
- Bot detection & mitigation
- DDoS attack prevention
- SQL injection prevention
- XSS attack detection
- Webhook signature validation (M-Pesa)

### 4.5 Communication

**Service Updates**:
- System maintenance notifications
- Security alerts
- Payment confirmations
- Subscription reminders
- Feature announcements

**Marketing** (with opt-in consent):
- Product updates
- Promotional offers
- Educational content
- Platform improvements
- Community events

---

## 5. Legal Basis for Processing (KDPA Article 5)

We process your personal data based on one of these legal grounds:

| Data | Purpose | Legal Basis |
|------|---------|------------|
| Business name, contact | Service delivery | Contractual necessity |
| Phone number, email | Account management | Contractual necessity |
| Sales transactions | Financial reporting | Legal obligation (KRA) |
| National ID, KRA PIN | Tax compliance | Legal obligation |
| IP address, device info | Security & fraud prevention | Legitimate interest |
| Payment data | Process payments | Contractual necessity |
| Communication logs | Customer support | Contractual necessity |
| Login/access logs | Audit trails | Legal obligation (KDPA Art 40) |

---

## 6. Data Encryption & Security

### 6.1 Encryption at Rest

**Sensitive fields encrypted with AES-256-GCM**:
- Phone numbers: `+254712345678` → encrypted
- National ID numbers: `12345678` → encrypted
- Email addresses: `user@example.com` → encrypted
- Bank account details: `0123456789` → encrypted

**Encryption Process**:
1. Generate random IV (Initialization Vector)
2. Apply AES-256-GCM encryption
3. Generate authentication tag (detects tampering)
4. Store as: `encryptedData.iv.authTag`

**Result**: Even if database is breached, encrypted data is unreadable without encryption key.

### 6.2 Encryption in Transit

**All connections use HTTPS/TLS 1.3**:
- Customer data protected during transmission
- M-Pesa API calls encrypted
- Certificate pinning for critical endpoints
- Perfect Forward Secrecy enabled

### 6.3 Additional Security Measures

**Rate Limiting**:
- 5 login attempts per 15 minutes per IP
- 10 statement verification requests per minute per IP
- Prevents brute force attacks

**Input Validation**:
- XSS prevention (HTML sanitization)
- SQL injection prevention (parameterized queries)
- Business name sanitization before PDF generation
- Phone number validation (format checking)

**Access Control**:
- Role-based access control (admin, user, guest)
- User can only see own business data
- Admin features protected by authentication
- Session tokens expire after 24 hours

**Webhook Security**:
- M-Pesa callbacks validated against whitelist of Safaricom IPs
- HMAC-SHA256 signature verification
- Timestamp validation (reject callbacks > 5 minutes old)
- Request body integrity checks

**Idempotency**:
- UUID-based idempotency keys prevent duplicate charges
- 24-hour cache prevents network retry issues
- Automatic cleanup of expired keys

---

## 7. Data Retention

### 7.1 How Long We Keep Data

| Data Type | Retention Period | Reason |
|-----------|-----------------|--------|
| Account information | Until deletion | Service provision |
| Transaction logs | 7 years | KRA tax compliance |
| Payment records | 7 years | Financial audit trail |
| Security logs | 90 days | Fraud investigation |
| User communications | 2 years | Customer support history |
| Device access logs | 30 days | Security monitoring |
| Support tickets | 2 years | Dispute resolution |
| Marketing emails | Until opt-out | Customer engagement |

### 7.2 Deletion

You can request data deletion, but we may retain data required by law:
- Transaction logs: 7 years (KRA requirement)
- Security/audit logs: 90 days (KDPA Article 40)
- Criminal records: Per court order

---

## 8. Who We Share Data With

### 8.1 Necessary Sharing

**Payment Processors**:
- **Safaricom (M-Pesa)**: Payment amount, phone number, transaction status
- Data shared: Minimal, transaction-specific, encrypted
- Agreement: Business Partner Agreement with data protection clauses

**Financial Compliance**:
- **Kenya Revenue Authority (KRA)**: Tax-related data per legal requirement
- Data shared: Business income, tax details (anonymized where possible)
- Basis: Legal obligation (Tax Act)

**Customer Service**:
- **Payment gateway support**: Technical logs (if troubleshooting needed)
- Data shared: Limited to incident information
- Agreement: Non-Disclosure Agreement

### 8.2 What We DO NOT Share

- Your encrypted phone numbers
- Your national ID numbers
- Your bank account details
- Your customer list
- Your sales records (except to KRA per law)
- Your password (never, even to support staff)

### 8.3 Third-Party Processors

We use third-party service providers:

| Service | Provider | Data Shared |
|---------|----------|------------|
| Cloud hosting | Neon PostgreSQL | Encrypted data |
| Email | SendGrid | Email address, notifications |
| Analytics | Google Analytics | Aggregate usage stats |
| Monitoring | Sentry (optional) | Error logs (anonymized) |
| CDN | Cloudflare (optional) | Traffic logs |

**All processors have Data Processing Agreements ensuring KDPA compliance.**

---

## 9. Your Rights Under KDPA 2019

### 9.1 Right to Access (Article 8)

**You can request**:
- All personal data we hold about you
- Proof of how we use your data
- Who we share data with
- Why we're processing your data

**How to request**:
```
Email: privacy@payme.co.ke
Subject: Data Access Request
Include: Your full name, account email, ID number
Response time: 14 calendar days
```

**What you'll receive**:
- PDF copy of all your data
- Explanation of processing purposes
- List of recipients
- Your retention period

### 9.2 Right to Correction (Article 9)

**You can request**:
- Fix inaccurate data
- Update outdated information
- Clarify incomplete data

**Examples**:
- Business name spelling correction
- Phone number change
- Location update

**How to request**:
- Log in → Settings → Edit Profile
- Or email: privacy@payme.co.ke

**Response time**: 7 days for simple corrections

### 9.3 Right to Erasure (Article 10)

**You can request deletion of**:
- Account and all associated data
- Communication records
- Marketing preferences

**Limitations**:
- Cannot delete transaction logs (KRA requires 7-year retention)
- Cannot delete data needed for active disputes
- Cannot delete security/audit logs (90-day retention)

**How to request**:
```
Email: privacy@payme.co.ke
Subject: Account Deletion Request
Include: Your full name, account email, confirmation of identity
Response time: 30 days (after final verification)
```

### 9.4 Right to Object (KDPA Article 11)

**You can object to**:
- Direct marketing communications
- Profiling/analytics
- Automated decision making

**How to object**:
- Email: privacy@payme.co.ke
- Unsubscribe link in emails
- Settings → Communication Preferences

**Response time**: 14 days

### 9.5 Right to Restrict Processing

**You can request**:
- Processing suspension
- Temporary limitations
- Pending your request resolution

**How to request**:
- Email: privacy@payme.co.ke
- Explain why you want restriction

### 9.6 Right to Data Portability

**You can request**:
- Your data in machine-readable format (JSON/CSV)
- Ability to move data to another service

**How to request**:
```
Email: privacy@payme.co.ke
Subject: Data Portability Request
Response time: 30 days
Format: JSON or CSV (your choice)
```

### 9.7 Right to Not Be Subject to Automated Decision Making

**You have the right to**:
- Receive human review of decisions affecting you
- Explanation of any automated decision
- Opt-out of profiling

**Examples**:
- Account suspension decisions
- Credit decisions
- Pricing adjustments

**How to request**:
- Email: dpo@payme.co.ke
- Explain which decision

---

## 10. Data Breach Notification

### 10.1 Our Commitment

If a breach of your personal data occurs, we will:

1. **Notify you within 72 hours** (or as required by law)
2. **Notify the Data Protection Commissioner** (if required)
3. **Provide details**:
   - What data was affected
   - Who might be affected
   - What measures we're taking
   - Steps you should take
   - Contact for more information

### 10.2 Our Security Measures to Prevent Breaches

- **Encryption**: All sensitive data encrypted at rest (AES-256-GCM)
- **Rate limiting**: Prevents brute force attacks
- **Access control**: Only authorized users can access data
- **Monitoring**: Continuous threat detection & logging
- **Updates**: Regular security patches
- **Testing**: Penetration testing & vulnerability scanning

### 10.3 Reported Breach Hotline

If you discover a breach:
```
Email: security@payme.co.ke
Phone: [Your Security Hotline Number]
Respond within: 2 hours
```

---

## 11. Cookies & Tracking

### 11.1 Session Cookies

We use **essential session cookies** for:
- Keeping you logged in
- Security (CSRF tokens)
- User preferences

**Type**: Session (deleted when you close browser)
**Necessity**: Essential (cannot use PayMe without)

### 11.2 Analytics Cookies (Optional)

We use **Google Analytics** to understand usage:
- Which features users prefer
- Where users encounter problems
- App performance metrics

**Type**: Persistent (last 30 days)
**Consent**: Opt-in at signup
**How to disable**: Settings → Privacy → Disable Analytics

### 11.3 Third-Party Cookies

**Cloudflare** (if enabled):
- DDoS protection
- Performance optimization
- Cookie: `__cfduid` (non-tracking)

**How to disable cookies**:
- Browser settings → Cookies
- Or in PayMe settings → Privacy

---

## 12. International Data Transfers

### 12.1 Where Your Data Is Stored

**Primary Location**: **Kenya (Neon PostgreSQL - Nairobi region)**
- Data stored within Kenya per DPA requirements
- Complies with KDPA Article 47 (Data locality)
- Reduces latency for Kenyan users

**Backup Locations** (if applicable):
- Rwanda or Mauritius (regional backup)
- Purpose: Disaster recovery only
- Encrypted during transfer
- Minimal non-sensitive data

### 12.2 US-Based Services (with safeguards)

Some services we use have US infrastructure:
- **Google Analytics**: Data anonymized
- **Sentry**: Error logs encrypted
- **Cloudflare**: Traffic only, no PII

**Protection**: Data Processing Agreements ensure KDPA compliance

---

## 13. Children's Privacy (Under 18)

**PayMe is for business use only.**

We do not knowingly collect data from anyone under 18. If you're under 18:
- You must have parental/guardian consent
- You must have business authority (own business)
- Your guardian must review this policy

If we discover we have data from a child, we'll delete it within 30 days.

---

## 14. Changes to This Policy

### 14.1 Policy Updates

We may update this policy:
- To reflect new laws (DPA amendments)
- To improve clarity
- To add new features
- To enhance security

### 14.2 How We Notify You

- **Email notification** to registered email
- **In-app notification** when you log in
- **Website banner** (30 days before change)
- **Effective date**: Typically 30 days after notice

### 14.3 Your Consent

By using PayMe after policy changes, you consent to the updated policy. If you disagree:
1. You can request data deletion
2. Stop using the platform
3. Contact our DPO to discuss concerns

**Current Version**: 1.0 (January 28, 2026)  
**Check for updates**: https://payme.co.ke/privacy

---

## 15. Contact Us

### Privacy Inquiries

```
Email: privacy@payme.co.ke
Response time: 7-14 business days
Include: Your full name, email, specific question
```

### Data Protection Officer

```
Email: dpo@payme.co.ke
Phone: [Your DPO Phone Number]
Response time: 5-10 business days
```

### Complaints to Regulator

If you're not satisfied with our response:

```
Kenya Data Protection Commissioner
Email: complaints@dpa.go.ke
Website: https://www.dpa.go.ke
Phone: +254 (0) 748 802 802
```

### General Inquiries

```
Email: support@payme.co.ke
Website: https://payme.co.ke
Hours: Monday-Friday, 9 AM - 5 PM EAT
```

---

## 16. Summary of Rights

| Right | How to Exercise | Timeline |
|------|-----------------|----------|
| **Access** | Email privacy@payme.co.ke | 14 days |
| **Correction** | Settings → Edit Profile | 7 days |
| **Erasure** | Email privacy@payme.co.ke | 30 days |
| **Restrict** | Email dpo@payme.co.ke | 14 days |
| **Portability** | Email privacy@payme.co.ke | 30 days |
| **Object** | Settings → Preferences | Immediate |
| **Not Automated** | Email dpo@payme.co.ke | 14 days |

---

## 17. Acknowledgments

This privacy policy is compliant with:
- ✅ **Kenya Data Protection Act, 2019**
- ✅ **Kenya Constitution, 2010** (Article 31)
- ✅ **Electronic Transactions & Cybercrimes Act, 2013**
- ✅ **GDPR** (for international users)
- ✅ **ISO 27001:2022** (Information Security)
- ✅ **International Best Practices** (OWASP, NIST)

---

## 18. Document Information

**Document**: PayMe Privacy Policy  
**Version**: 1.0  
**Effective Date**: January 28, 2026  
**Last Updated**: January 28, 2026  
**Next Review**: January 28, 2027  

**Document Owner**: Data Protection Officer (dpo@payme.co.ke)  
**Approval**: PayMe Management & Legal Team  

---

**Thank you for using PayMe. Your privacy and security are our top priorities.**

For any questions, contact: **privacy@payme.co.ke**

🔒 **Stay Safe, Stay Secure, Grow Your Business with PayMe**
