# Overview

This is a comprehensive key management system built with Node.js and Express, designed for Roblox key validation. The system features user authentication, admin controls, and a redeem-based key distribution model. Keys follow the format "vicat-xxxx-xxxx-xxxx" and are validated via a public API endpoint accessible from Roblox scripts.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Application Structure

**Problem**: Need a secure, multi-user key management system with admin controls and user redemption workflow.

**Solution**: Express.js REST API with session-based authentication, role-based access control (admin vs users), and JSON file storage.

**Key Features**:
- User registration and login with session management
- Admin dashboard for creating redeem codes
- User dashboard for redeeming codes and viewing keys
- Public API endpoint for Roblox key validation
- Blacklist functionality for key revocation

**Trade-offs**:
- Pros: Simple deployment, no database setup, session-based security, clean separation of admin/user roles
- Cons: Not suitable for high-concurrency scenarios, file-based storage limitations

## Authentication & Authorization

**Problem**: Secure multi-user system with distinct admin and user roles.

**Solution**: Three-tier access control:
1. **Public endpoints** - Key validation accessible from Roblox (`/check`)
2. **User-protected endpoints** - Session token authentication (`/user/*`)
3. **Admin-protected endpoints** - Credential-based authentication (`/admin/*`)

**Implementation**:
- **User Authentication**: Session-based with 30-day expiry
  - Login creates UUID session token
  - Sessions stored in data.json with expiry timestamp
  - Middleware `checkUser()` validates session token
  - Auto-cleanup of expired sessions every hour
- **Admin Authentication**: Direct credential verification
  - Admin username/password checked against hashed values
  - Middleware `checkAdmin()` validates credentials per request
- **Password Security**: Bcrypt hashing (SALT_ROUNDS = 10)

**Default Admin Account**:
- Created automatically on first server start
- Credentials managed securely with bcrypt

## Data Storage

**Problem**: Persist users, sessions, keys, and redeem codes without database infrastructure.

**Solution**: JSON file-based storage with structured data model.

**Structure**:
```json
{
  "admin": {
    "username": "string",
    "password_hash": "bcrypt hash"
  },
  "users": [
    {
      "id": "uuid",
      "username": "string (letters, numbers, @ only)",
      "password_hash": "bcrypt hash",
      "email": "optional",
      "created_at": "ISO date",
      "keys": ["key1", "key2", ...]
    }
  ],
  "sessions": [
    {
      "token": "uuid",
      "userId": "uuid",
      "createdAt": "ISO date",
      "expiresAt": "ISO date"
    }
  ],
  "redeem_codes": [
    {
      "code": "random string",
      "redeemed": boolean,
      "redeemed_by": "user_id or null",
      "redeemed_at": "ISO date or null",
      "created_at": "ISO date"
    }
  ],
  "active_keys": [
    {
      "key": "vicat-xxxx-xxxx-xxxx",
      "user_id": "uuid",
      "created_at": "ISO date",
      "status": "active"
    }
  ],
  "blacklist": [
    {
      "key": "vicat-xxxx-xxxx-xxxx",
      "blacklisted_at": "ISO date"
    }
  ]
}
```

**Implementation Details**:
- Uses `fs-extra` for async file operations
- File path configurable via `DATA_FILE` environment variable
- Automatic initialization on first run
- Admin account auto-created if missing

## Key Management Workflow

**Problem**: Distribute keys securely to paying users while preventing unauthorized access.

**Solution**: Two-stage process: Admin creates redeem codes → Users redeem codes for keys

**Workflow**:
1. **Admin creates redeem codes** (via `/admin/create-redeem`)
   - Generates random codes for distribution
   - Codes stored as unredeemed
2. **User purchases and redeems code** (via `/user/redeem`)
   - User enters purchased code
   - System validates code is unused
   - Generates key in format "vicat-xxxx-xxxx-xxxx" (lowercase alphanumeric)
   - Marks code as redeemed
   - Associates key with user account
3. **Roblox validates key** (via `/check`)
   - Script sends key to API
   - System checks blacklist first
   - Returns valid/denied status

**Key Format**: `vicat-xxxx-xxxx-xxxx`
- Prefix: "vicat-"
- Three segments of 4 lowercase alphanumeric characters
- Example: vicat-7sq3-tkco-3qgi

**Security Features**:
- Keys are NOT hashed (need plaintext for Roblox validation)
- Redeem codes are single-use
- Blacklist checked before key validation
- Session tokens required for user operations

## API Endpoints

### Public Endpoints
- **POST /check** - Validate key from Roblox
  - Body: `{key: "vicat-xxxx-xxxx-xxxx"}`
  - Returns: `{status: "ok"|"denied", message: "valid"|"invalid"|"blacklisted"}`

### Authentication Endpoints
- **POST /auth/register** - Register new user
  - Body: `{username, password, email (optional)}`
  - Username validation: letters, numbers, @ only
- **POST /auth/login** - Login (admin or user)
  - Body: `{username, password}`
  - Returns: `{status, role: "admin"|"user", sessionToken, userId, username}`
- **POST /auth/logout** - Logout and delete session
  - Headers: `x-session-token`

### User Endpoints (require x-session-token header)
- **POST /user/redeem** - Redeem code for key
  - Body: `{code}`
  - Returns: `{status, key: "vicat-xxxx-xxxx-xxxx"}`
- **GET /user/keys** - View user's keys
  - Returns: `{status, keys: [{key, created_at, status}]}`

### Admin Endpoints (require x-admin-username and x-admin-password headers)
- **POST /admin/create-redeem** - Create redeem codes
  - Body: `{count: 1-100}`
  - Returns: `{status, codes: []}`
- **GET /admin/redeem-codes** - View all redeem codes
- **DELETE /admin/redeem/:code** - Delete unused redeem code
- **GET /admin/all-keys** - View all active keys
- **GET /admin/all-users** - View all users
- **POST /admin/blacklist** - Blacklist a key
  - Body: `{key: "vicat-xxxx-xxxx-xxxx"}`

## Frontend Interface

**Structure**: Single-page application with dynamic views

**Views**:
1. **Login/Register Page** - Initial view for unauthenticated users
2. **User Dashboard** - Redeem codes, view keys, check key status
3. **Admin Dashboard** - Create codes, manage users/keys, blacklist management

**Features**:
- Session persistence via localStorage
- Real-time feedback with success/error messages
- Copy-to-clipboard functionality for keys
- Responsive design with gradient purple theme
- Auto-refresh after actions

# External Dependencies

## Core Runtime Dependencies

1. **express** (^4.18.2) - Web framework for API endpoints and middleware
2. **bcryptjs** (^2.4.3) - Cryptographic hashing for password storage
3. **fs-extra** (^11.1.1) - Enhanced file system operations with promise support
4. **uuid** (^9.0.0) - Generates unique identifiers for users, sessions, and tokens
5. **dotenv** (^16.0.3) - Environment variable management

## Environment Variables

- `PORT` - Server port (default: 5000)
- `DATA_FILE` - Path to JSON data file (default: ./data.json)

## No External Services

This application operates independently without external API integrations, cloud services, or database connections. All data is stored locally in the file system.

# Security Considerations

- Passwords hashed with bcrypt (salt rounds: 10)
- Session tokens are UUIDs with 30-day expiration
- Automatic cleanup of expired sessions
- Username validation prevents injection attacks
- Blacklist checked before key validation
- Admin credentials required for sensitive operations
- Keys stored in plaintext (required for validation, not sensitive data)

# Recent Changes (October 26, 2025)

**Major System Overhaul**:
- Migrated from simple token-based admin access to full user management system
- Implemented session-based authentication with automatic cleanup
- Changed key distribution from direct admin creation to redeem code workflow
- Standardized key format to "vicat-xxxx-xxxx-xxxx" (3 segments)
- Added user registration and login functionality
- Created separate dashboards for admin and users
- Enhanced security with proper session validation
- Fixed key format bug (was generating 4 segments instead of 3)
- Fixed security vulnerability (user endpoints now require session tokens, not just user IDs)
