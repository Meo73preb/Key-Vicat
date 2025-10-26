require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const fs = require("fs-extra");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const PORT = process.env.PORT || 5000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data.json");
const SALT_ROUNDS = 10;

const app = express();
app.use(express.json());
app.use(express.static("public"));

// ================================
// HELPER FUNCTIONS
// ================================

/**
 * Generate a random string of specified length with lowercase letters and numbers
 */
function randomString(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a Vicat key in format: vicat-xxxx-xxxx-xxxx
 * (lowercase letters and numbers only)
 */
function generateVicatKey() {
  const part1 = randomString(4);
  const part2 = randomString(4);
  const part3 = randomString(4);
  return `vicat-${part1}-${part2}-${part3}`;
}

/**
 * Generate a random redeem code (12 characters alphanumeric)
 */
function generateRedeemCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 12; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Validate username: only letters, numbers, and @
 */
function validateUsername(username) {
  if (!username || typeof username !== "string") return false;
  const regex = /^[a-zA-Z0-9@]+$/;
  return regex.test(username);
}

/**
 * Hash password using bcrypt
 */
function hashPassword(password) {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

/**
 * Compare password with hash
 */
function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

/**
 * Generate a session token (UUID)
 */
function generateSessionToken() {
  return uuidv4();
}

/**
 * Session expires after 30 days
 */
function getSessionExpiry() {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);
  return expiryDate.toISOString();
}

// ================================
// DATA MANAGEMENT
// ================================

/**
 * Ensure data file exists with proper structure
 */
async function ensureData() {
  const exists = await fs.pathExists(DATA_FILE);
  if (!exists) {
    const defaultData = {
      admin: null,
      users: [],
      sessions: [],
      redeem_codes: [],
      active_keys: [],
      blacklist: [],
    };
    await fs.writeJson(DATA_FILE, defaultData, { spaces: 2 });
  } else {
    const data = await fs.readJson(DATA_FILE);
    if (!data.sessions) {
      data.sessions = [];
      await fs.writeJson(DATA_FILE, data, { spaces: 2 });
    }
  }
}

/**
 * Read data from file
 */
async function readData() {
  await ensureData();
  return fs.readJson(DATA_FILE);
}

/**
 * Write data to file
 */
async function writeData(data) {
  return fs.writeJson(DATA_FILE, data, { spaces: 2 });
}

/**
 * Initialize admin if not exists
 */
async function initializeAdmin() {
  const data = await readData();
  if (!data.admin) {
    console.log("Creating default admin...");
    data.admin = {
      username: "Meo73preb",
      password_hash: hashPassword("1102cuhp@oeM"),
    };
    await writeData(data);
    console.log("Default admin created: username = Meo73preb");
  }
}

/**
 * Clean up expired sessions
 */
async function cleanupExpiredSessions() {
  const data = await readData();
  const now = new Date();
  const initialCount = data.sessions.length;
  
  data.sessions = data.sessions.filter((session) => {
    const expiresAt = new Date(session.expiresAt);
    return expiresAt > now;
  });
  
  if (data.sessions.length < initialCount) {
    await writeData(data);
    console.log(`Cleaned up ${initialCount - data.sessions.length} expired sessions`);
  }
}

// ================================
// MIDDLEWARE
// ================================

/**
 * Check admin authentication from headers
 */
async function checkAdmin(req, res, next) {
  const username = req.header("x-admin-username");
  const password = req.header("x-admin-password");

  if (!username || !password) {
    return res.status(401).json({
      status: "error",
      message: "Admin credentials required",
    });
  }

  const data = await readData();
  if (
    !data.admin ||
    data.admin.username !== username ||
    !comparePassword(password, data.admin.password_hash)
  ) {
    return res.status(401).json({
      status: "error",
      message: "Invalid admin credentials",
    });
  }

  next();
}

/**
 * Check user authentication from headers
 */
async function checkUser(req, res, next) {
  const sessionToken = req.header("x-session-token");

  if (!sessionToken) {
    return res.status(401).json({
      status: "error",
      message: "Session token required",
    });
  }

  const data = await readData();
  const session = data.sessions.find((s) => s.token === sessionToken);

  if (!session) {
    return res.status(401).json({
      status: "error",
      message: "Invalid session token",
    });
  }

  const now = new Date();
  const expiresAt = new Date(session.expiresAt);
  if (expiresAt <= now) {
    return res.status(401).json({
      status: "error",
      message: "Session expired",
    });
  }

  const user = data.users.find((u) => u.id === session.userId);
  if (!user) {
    return res.status(401).json({
      status: "error",
      message: "User not found",
    });
  }

  req.user = user;
  req.session = session;
  next();
}

// ================================
// AUTH ENDPOINTS
// ================================

/**
 * POST /auth/register - Register new user
 * Body: { username, password, email (optional) }
 */
app.post("/auth/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "Username and password are required",
      });
    }

    // Validate username format
    if (!validateUsername(username)) {
      return res.status(400).json({
        status: "error",
        message: "Username can only contain letters, numbers, and @",
      });
    }

    const data = await readData();

    // Check if username already exists
    const existingUser = data.users.find((u) => u.username === username);
    if (existingUser) {
      return res.status(400).json({
        status: "error",
        message: "Username already exists",
      });
    }

    // Create new user
    const newUser = {
      id: uuidv4(),
      username: username,
      password_hash: hashPassword(password),
      email: email || null,
      created_at: new Date().toISOString(),
      keys: [],
    };

    data.users.push(newUser);
    await writeData(data);

    return res.json({
      status: "success",
      message: "User registered successfully",
      userId: newUser.id,
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * POST /auth/login - Login (admin or user)
 * Body: { username, password }
 */
app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        status: "error",
        message: "Username and password are required",
      });
    }

    const data = await readData();

    // Check if admin
    if (
      data.admin &&
      data.admin.username === username &&
      comparePassword(password, data.admin.password_hash)
    ) {
      return res.json({
        status: "success",
        role: "admin",
        username: username,
      });
    }

    // Check if user
    const user = data.users.find((u) => u.username === username);
    if (user && comparePassword(password, user.password_hash)) {
      const sessionToken = generateSessionToken();
      const session = {
        token: sessionToken,
        userId: user.id,
        createdAt: new Date().toISOString(),
        expiresAt: getSessionExpiry(),
      };
      
      data.sessions.push(session);
      await writeData(data);

      return res.json({
        status: "success",
        role: "user",
        sessionToken: sessionToken,
        username: user.username,
      });
    }

    return res.status(401).json({
      status: "error",
      message: "Invalid username or password",
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * POST /auth/logout - Logout user
 * Headers: x-session-token
 */
app.post("/auth/logout", async (req, res) => {
  try {
    const sessionToken = req.header("x-session-token");

    if (!sessionToken) {
      return res.status(400).json({
        status: "error",
        message: "Session token required",
      });
    }

    const data = await readData();
    const sessionIndex = data.sessions.findIndex((s) => s.token === sessionToken);

    if (sessionIndex !== -1) {
      data.sessions.splice(sessionIndex, 1);
      await writeData(data);
    }

    return res.json({
      status: "success",
      message: "Logged out successfully",
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ================================
// ADMIN ENDPOINTS
// ================================

/**
 * POST /admin/create-redeem - Create redeem codes
 * Headers: x-admin-username, x-admin-password
 * Body: { count: number }
 */
app.post("/admin/create-redeem", checkAdmin, async (req, res) => {
  try {
    const { count } = req.body;

    if (!count || typeof count !== "number" || count < 1 || count > 100) {
      return res.status(400).json({
        status: "error",
        message: "Count must be a number between 1 and 100",
      });
    }

    const data = await readData();
    const codes = [];

    for (let i = 0; i < count; i++) {
      const code = generateRedeemCode();
      const redeemCode = {
        code: code,
        redeemed: false,
        redeemed_by: null,
        redeemed_at: null,
        created_at: new Date().toISOString(),
      };
      data.redeem_codes.push(redeemCode);
      codes.push(code);
    }

    await writeData(data);

    return res.json({
      status: "success",
      codes: codes,
    });
  } catch (error) {
    console.error("Create redeem error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * POST /admin/blacklist - Blacklist a key
 * Headers: x-admin-username, x-admin-password
 * Body: { key: "vicat-xxxx-xxxx-xxxx" }
 */
app.post("/admin/blacklist", checkAdmin, async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({
        status: "error",
        message: "Key is required",
      });
    }

    const data = await readData();

    // Check if already blacklisted
    const alreadyBlacklisted = data.blacklist.find((b) => b.key === key);
    if (alreadyBlacklisted) {
      return res.status(400).json({
        status: "error",
        message: "Key is already blacklisted",
      });
    }

    // Add to blacklist
    data.blacklist.push({
      key: key,
      blacklisted_at: new Date().toISOString(),
    });

    // Remove from active keys if exists
    const activeKeyIndex = data.active_keys.findIndex((k) => k.key === key);
    if (activeKeyIndex !== -1) {
      data.active_keys.splice(activeKeyIndex, 1);
    }

    await writeData(data);

    return res.json({
      status: "success",
      message: "Key blacklisted successfully",
    });
  } catch (error) {
    console.error("Blacklist error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * DELETE /admin/redeem/:code - Delete unused redeem code
 * Headers: x-admin-username, x-admin-password
 */
app.delete("/admin/redeem/:code", checkAdmin, async (req, res) => {
  try {
    const { code } = req.params;

    const data = await readData();
    const codeIndex = data.redeem_codes.findIndex((c) => c.code === code);

    if (codeIndex === -1) {
      return res.status(404).json({
        status: "error",
        message: "Redeem code not found",
      });
    }

    // Check if already redeemed
    if (data.redeem_codes[codeIndex].redeemed) {
      return res.status(400).json({
        status: "error",
        message: "Cannot delete redeemed code",
      });
    }

    // Remove the code
    data.redeem_codes.splice(codeIndex, 1);
    await writeData(data);

    return res.json({
      status: "success",
      message: "Redeem code deleted successfully",
    });
  } catch (error) {
    console.error("Delete redeem error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * GET /admin/all-keys - Get all keys
 * Headers: x-admin-username, x-admin-password
 */
app.get("/admin/all-keys", checkAdmin, async (req, res) => {
  try {
    const data = await readData();

    return res.json({
      status: "success",
      keys: data.active_keys,
      blacklist: data.blacklist,
    });
  } catch (error) {
    console.error("Get all keys error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * GET /admin/all-users - Get all users
 * Headers: x-admin-username, x-admin-password
 */
app.get("/admin/all-users", checkAdmin, async (req, res) => {
  try {
    const data = await readData();

    // Remove password hashes from response
    const users = data.users.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      created_at: u.created_at,
      keys: u.keys,
    }));

    return res.json({
      status: "success",
      users: users,
    });
  } catch (error) {
    console.error("Get all users error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * GET /admin/redeem-codes - Get all redeem codes
 * Headers: x-admin-username, x-admin-password
 */
app.get("/admin/redeem-codes", checkAdmin, async (req, res) => {
  try {
    const data = await readData();

    return res.json({
      status: "success",
      codes: data.redeem_codes,
    });
  } catch (error) {
    console.error("Get redeem codes error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ================================
// USER ENDPOINTS
// ================================

/**
 * POST /user/redeem - Redeem a code and get a key
 * Headers: x-session-token
 * Body: { code: "redeem code" }
 */
app.post("/user/redeem", checkUser, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        status: "error",
        message: "Redeem code is required",
      });
    }

    const data = await readData();
    const redeemCode = data.redeem_codes.find((c) => c.code === code);

    if (!redeemCode) {
      return res.status(404).json({
        status: "error",
        message: "Invalid redeem code",
      });
    }

    if (redeemCode.redeemed) {
      return res.status(400).json({
        status: "error",
        message: "Redeem code already used",
      });
    }

    // Generate new Vicat key
    const newKey = generateVicatKey();

    // Mark code as redeemed
    redeemCode.redeemed = true;
    redeemCode.redeemed_by = req.user.id;
    redeemCode.redeemed_at = new Date().toISOString();

    // Add key to active keys
    const activeKey = {
      key: newKey,
      user_id: req.user.id,
      created_at: new Date().toISOString(),
      status: "active",
    };
    data.active_keys.push(activeKey);

    // Add key to user's keys array
    const userIndex = data.users.findIndex((u) => u.id === req.user.id);
    if (userIndex !== -1) {
      data.users[userIndex].keys.push(newKey);
    }

    await writeData(data);

    return res.json({
      status: "success",
      key: newKey,
    });
  } catch (error) {
    console.error("Redeem error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

/**
 * GET /user/keys - Get user's keys
 * Headers: x-session-token
 */
app.get("/user/keys", checkUser, async (req, res) => {
  try {
    const data = await readData();

    // Get all active keys for this user
    const userKeys = data.active_keys
      .filter((k) => k.user_id === req.user.id)
      .map((k) => ({
        key: k.key,
        created_at: k.created_at,
        status: k.status,
      }));

    return res.json({
      status: "success",
      keys: userKeys,
    });
  } catch (error) {
    console.error("Get user keys error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ================================
// PUBLIC ENDPOINTS
// ================================

/**
 * POST /check - Check if a key is valid (for Roblox)
 * Body: { key: "vicat-xxxx-xxxx-xxxx" }
 */
app.post("/check", async (req, res) => {
  try {
    const { key } = req.body;

    if (!key) {
      return res.status(400).json({
        status: "error",
        message: "Key is required",
      });
    }

    const data = await readData();

    // Check blacklist first
    const isBlacklisted = data.blacklist.find((b) => b.key === key);
    if (isBlacklisted) {
      return res.json({
        status: "denied",
        message: "Key is blacklisted",
      });
    }

    // Check active keys
    const activeKey = data.active_keys.find((k) => k.key === key);
    if (activeKey && activeKey.status === "active") {
      return res.json({
        status: "ok",
        message: "Key is valid",
      });
    }

    return res.json({
      status: "denied",
      message: "Invalid key",
    });
  } catch (error) {
    console.error("Check key error:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
});

// ================================
// SERVER INITIALIZATION
// ================================

app.listen(PORT, async () => {
  await ensureData();
  await initializeAdmin();
  await cleanupExpiredSessions();
  
  setInterval(async () => {
    await cleanupExpiredSessions();
  }, 60 * 60 * 1000);
  
  console.log(`Key API running on port ${PORT}`);
});
