const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { URL } = require("node:url");
const { Pool } = require("pg");
const { DatabaseSync } = require("node:sqlite");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_FORM_BYTES = 5 * 1024 * 1024;
const AVATAR_UPLOAD_DIR = path.join(ROOT, "uploads", "avatars");
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Admin123!";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const DEFAULT_ADMIN_PASSWORD = "Admin123!";
const INSURANCE_CODE = "3690NH";
const DATABASE_URL = process.env.DATABASE_URL || "";
const USE_POSTGRES = Boolean(DATABASE_URL);
const PUBLIC_DENYLIST = new Set([
  "/server.js",
  "/start-server.cmd",
  "/package.json",
  "/render.yaml",
]);
const PUBLIC_DENYLIST_PREFIXES = [
  "/data/",
];

if (IS_PRODUCTION && ADMIN_PASSWORD === DEFAULT_ADMIN_PASSWORD) {
  throw new Error("ADMIN_PASSWORD must be set to a non-default value in production.");
}

if (IS_PRODUCTION && !DATABASE_URL) {
  throw new Error("DATABASE_URL must be set in production.");
}

const db = createDatabaseClient();

const PROTECTED_PAGES = new Set([
  "/admin/dashboard.html",
  "/admin/deposit.html",
  "/admin/wire-transfer.html",
  "/admin/dom-transfer.html",
  "/admin/loan.html",
  "/admin/transaction.html",
  "/admin/profile.html",
]);

const PAGE_ALIASES = {
  "/dashboard": "admin/dashboard.html",
  "/deposit": "admin/deposit.html",
  "/wire-transfer": "admin/wire-transfer.html",
  "/dom-transfer": "admin/dom-transfer.html",
  "/loan": "admin/loan.html",
  "/transaction": "admin/transaction.html",
  "/profile": "admin/profile.html",
};

const ADMIN_PROTECTED_PAGES = new Set([
  "/admin-backoffice/dashboard.html",
]);

const ADMIN_PAGE_ALIASES = {
  "/admin-backoffice": "admin-backoffice/dashboard.html",
  "/admin-backoffice/dashboard": "admin-backoffice/dashboard.html",
  "/admin-backoffice/login": "admin-backoffice/login.html",
};

const createUserSql = `
  INSERT INTO users (
    account_number, first_name, last_name, username, email, phone, gender,
    date_of_birth, country, state, zip_code, marital_status, ssn, occupation,
    address, profile_image, preferred_currency, transfer_flow_state, transfer_otp_code, transfer_fdic_code, transfer_banking_code, password_hash
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
  RETURNING id
`;
const createTransactionSql = `
  INSERT INTO transactions (
    user_id, reference_id, category, type, description, amount, status, currency_code, created_at, metadata_json
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
`;
const createLoanSql = `
  INSERT INTO loan_applications (user_id, amount, duration, reason, status, created_at)
  VALUES ($1, $2, $3, $4, $5, $6)
`;

async function initDatabase() {
  await db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    account_number TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    gender TEXT,
    date_of_birth TEXT,
    country TEXT,
    state TEXT,
    zip_code TEXT,
    marital_status TEXT,
    ssn TEXT,
    occupation TEXT,
    address TEXT,
    profile_image TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    preferred_currency TEXT NOT NULL DEFAULT 'USD',
    transfer_flow_state TEXT NOT NULL DEFAULT 'pending_transfer',
    transfer_otp_code TEXT NOT NULL DEFAULT '',
    transfer_fdic_code TEXT NOT NULL DEFAULT '',
    transfer_banking_code TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    session_token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    insurance_verified INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id SERIAL PRIMARY KEY,
    session_token TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    reference_id TEXT,
    category TEXT,
    type TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    status TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata_json TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS loan_applications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    duration TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_currency TEXT NOT NULL DEFAULT 'USD'");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS transfer_flow_state TEXT NOT NULL DEFAULT 'pending_transfer'");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS transfer_otp_code TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS transfer_fdic_code TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS transfer_banking_code TEXT NOT NULL DEFAULT ''");
  await db.query("ALTER TABLE sessions ADD COLUMN IF NOT EXISTS insurance_verified INTEGER NOT NULL DEFAULT 0");
  await db.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS reference_id TEXT");
  await db.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS category TEXT");
  await db.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS currency_code TEXT NOT NULL DEFAULT 'USD'");
  await db.query("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS metadata_json TEXT");

  const countUsers = Number((await dbGet("SELECT COUNT(*) AS total FROM users")).total);
  if (countUsers === 0 && !IS_PRODUCTION) {
    await seedDemoData();
  }
}

async function dbGet(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

async function dbAll(sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

async function dbRun(sql, params = []) {
  const result = await db.query(sql, params);
  return {
    rowCount: result.rowCount,
    lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined,
  };
}

function createDatabaseClient() {
  if (USE_POSTGRES) {
    const pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: !/localhost|127\.0\.0\.1/i.test(DATABASE_URL)
        ? { rejectUnauthorized: false }
        : undefined,
    });

    return {
      query(sql, params = []) {
        return pool.query(sql, params);
      },
    };
  }

  const sqlite = new DatabaseSync(path.join(ROOT, "data", "corpus.sqlite"));
  sqlite.exec("PRAGMA foreign_keys = ON");

  return {
    async query(sql, params = []) {
      const statements = normalizeSqlForSqlite(sql)
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);

      let rows = [];
      let rowCount = 0;

      for (const statement of statements) {
        try {
          const prepared = sqlite.prepare(statement);
          if (/^\s*SELECT\b/i.test(statement) || /\bRETURNING\b/i.test(statement)) {
            rows = prepared.all(...params);
            rowCount = rows.length;
          } else {
            const result = prepared.run(...params);
            rowCount = result.changes || 0;
            rows = result.lastInsertRowid ? [{ id: result.lastInsertRowid }] : [];
          }
        } catch (error) {
          if (/duplicate column name/i.test(error.message)) {
            continue;
          }
          throw error;
        }
      }

      return { rows, rowCount };
    },
  };
}

function normalizeSqlForSqlite(sql) {
  return sql
    .replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT")
    .replace(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/gi, "ADD COLUMN")
    .replace(/\$[0-9]+/g, "?");
}

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".cmd": "text/plain; charset=utf-8",
};

const COUNTRY_STATES = {
  "37": ["Lagos", "Abuja", "Kano", "Rivers"],
  "38": ["Ontario", "Quebec", "British Columbia", "Alberta"],
  "83": ["Greater Accra", "Ashanti", "Northern", "Volta"],
  "160": ["Dubai", "Abu Dhabi", "Sharjah", "Ajman"],
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "GET" && url.pathname === "/") {
      return serveFile(res, path.join(ROOT, "index.html"));
    }

    if (req.method === "GET" && url.pathname === "/auth/login") {
      return redirect(res, "/auth/login.html");
    }

    if (req.method === "GET" && ADMIN_PAGE_ALIASES[url.pathname]) {
      const filePath = path.join(ROOT, ADMIN_PAGE_ALIASES[url.pathname]);
      if (url.pathname === "/admin-backoffice/login") {
        return serveFile(res, filePath);
      }
      return await serveAdminPage(req, res, filePath);
    }

    if (req.method === "GET" && PAGE_ALIASES[url.pathname]) {
      return await serveProtectedPage(req, res, path.join(ROOT, PAGE_ALIASES[url.pathname]));
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      return await handlePortalData(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/portal-data") {
      return await handlePortalData(req, res);
    }

    if (req.method === "GET" && url.pathname === "/api/admin-data") {
      return await handleAdminData(req, res);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return respondJson(res, 200, {
        ok: true,
        now: new Date().toISOString(),
        node: process.version,
        database: USE_POSTGRES ? "postgres" : "sqlite",
      });
    }

    if (req.method === "GET" && url.pathname === "/api/states") {
      return handleStates(res, url.searchParams.get("country"));
    }

    if (req.method === "POST" && url.pathname === "/login") {
      return collectForm(req, res, (form) => handleLogin(res, form));
    }

    if (req.method === "GET" && url.pathname === "/insurance-code") {
      return await serveInsuranceCodePage(req, res);
    }

    if (req.method === "POST" && url.pathname === "/insurance-code") {
      return collectForm(req, res, (form) => handleInsuranceCodeSubmit(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/register") {
      return collectForm(req, res, (form) => handleRegister(res, form));
    }

    if (req.method === "POST" && url.pathname === "/logout") {
      return await handleLogout(req, res);
    }

    if (req.method === "POST" && url.pathname === "/deposit") {
      return collectForm(req, res, (form) => handleDeposit(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/wire-transfer") {
      return collectForm(req, res, (form) => handleWireTransfer(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/dom-transfer") {
      return collectForm(req, res, (form) => handleDomesticTransfer(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/loan") {
      return collectForm(req, res, (form) => handleLoan(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/profile/update") {
      return collectForm(req, res, (form) => handleProfileUpdate(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/admin/login") {
      return collectForm(req, res, (form) => handleAdminLogin(res, form));
    }

    if (req.method === "POST" && url.pathname === "/admin/logout") {
      return await handleAdminLogout(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/admin/users/create") {
      return collectForm(req, res, (form) => handleAdminCreateUser(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/users/update") {
      return collectForm(req, res, (form) => handleAdminUpdateUser(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/users/delete") {
      return collectForm(req, res, (form) => handleAdminDeleteUser(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/users/adjust-balance") {
      return collectForm(req, res, (form) => handleAdminAdjustBalance(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/transactions/create") {
      return collectForm(req, res, (form) => handleAdminCreateTransaction(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/transactions/update") {
      return collectForm(req, res, (form) => handleAdminUpdateTransaction(req, res, form));
    }

    if (req.method === "POST" && url.pathname === "/api/admin/loans/update") {
      return collectForm(req, res, (form) => handleAdminUpdateLoan(req, res, form));
    }

    if (req.method === "GET" && PROTECTED_PAGES.has(url.pathname)) {
      return await serveProtectedPage(req, res, path.join(ROOT, url.pathname));
    }

    if (req.method === "GET" && ADMIN_PROTECTED_PAGES.has(url.pathname)) {
      return await serveAdminPage(req, res, path.join(ROOT, url.pathname));
    }

    if (req.method === "GET") {
      if (isPubliclyBlockedPath(url.pathname)) {
        return respondText(res, 404, "Not Found");
      }
      const safePath = safeJoin(ROOT, decodeURIComponent(url.pathname));
      if (!safePath) {
        return respondText(res, 403, "Forbidden");
      }
      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        return serveFile(res, safePath);
      }
    }

    respondText(res, 404, "Not Found");
  } catch (error) {
    console.error(error);
    respondText(res, 500, "Internal Server Error");
  }
});

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await initDatabase();
  server.listen(PORT, () => {
    console.log(`Corpus local server running at http://localhost:${PORT}`);
    console.log(`Environment: ${IS_PRODUCTION ? "production" : "development"}`);
    console.log(`Database: ${USE_POSTGRES ? "Postgres" : "SQLite"}`);
    if (!IS_PRODUCTION) {
      console.log("Demo login: account 10000001 / password Password123!");
      console.log(`Admin login: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
    }
  });
}

async function seedDemoData() {
  const passwordHash = hashPassword("Password123!");
  const accountNumber = "10000001";
  const result = await dbRun(createUserSql, [
    accountNumber,
    "Developer",
    "Plug",
    "developerplug",
    "developer@corpus.local",
    "+1 555 0100",
    "Male",
    "1990-01-01",
    "United States",
    "California",
    "90001",
    "Single",
    "1234",
    "Account Manager",
    "123 Demo Street",
    "/assets/home/images/MANredd.png",
    "USD",
    "pending_transfer",
    "240298",
    "",
    "",
    passwordHash,
  ]);

  const userId = Number(result.lastInsertRowid);
  await createTransaction(userId, {
    referenceId: "DP873",
    category: "deposit",
    type: "credit",
    description: "Mobile Deposit",
    amount: 22954.0,
    status: "Pending",
    createdAt: "2025-12-01 19:17:00",
  });
  await createTransaction(userId, {
    referenceId: "CR124",
    category: "deposit",
    type: "credit",
    description: "Payroll Credit",
    amount: 35000.0,
    status: "Completed",
    createdAt: "2026-01-04 10:00:00",
  });
  await createTransaction(userId, {
    referenceId: "CR300",
    category: "deposit",
    type: "credit",
    description: "Investment Return",
    amount: 28738.0,
    status: "Completed",
    createdAt: "2026-02-11 08:20:00",
  });
  await createTransaction(userId, {
    referenceId: "DB822",
    category: "wire_transfer",
    type: "debit",
    description: "International Wire Transfer",
    amount: -350.0,
    status: "Completed",
    createdAt: "2026-03-09 15:45:00",
  });

  await dbRun(createLoanSql, [userId, 345.0, "6 months", "Emergency cash flow support", "Due", "2026-03-12 11:00:00"]);
}

async function serveProtectedPage(req, res, filePath) {
  const session = await getSessionUser(req);
  if (!session) {
    return redirect(res, "/auth/login.html?error=Please+sign+in+first");
  }
  if (Number(session.insurance_verified) !== 1) {
    return redirect(res, "/insurance-code");
  }
  return serveFile(res, filePath);
}

async function serveAdminPage(req, res, filePath) {
  const session = await getAdminSession(req);
  if (!session) {
    return redirect(res, "/admin-backoffice/login.html?error=Please+sign+in+as+admin");
  }
  return serveFile(res, filePath);
}

async function handleLogin(res, form) {
  const accountNumber = (form.acct_number || "").trim();
  const password = form.password || "";
  const user = await dbGet("SELECT * FROM users WHERE account_number = $1", [accountNumber]);

  if (!user || !verifyPassword(password, user.password_hash)) {
    return redirect(res, "/auth/login.html?error=Invalid+account+number+or+password");
  }

  const sessionToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await dbRun("INSERT INTO sessions (session_token, user_id, expires_at, insurance_verified) VALUES ($1, $2, $3, $4)", [sessionToken, user.id, expiresAt, 0]);

  res.writeHead(302, {
    Location: "/insurance-code",
    "Set-Cookie": cookieHeader("session", sessionToken, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
      sameSite: "Lax",
      secure: IS_PRODUCTION,
    }),
  });
  res.end();
}

async function handleRegister(res, form) {
  const firstName = (form.firstname || "").trim();
  const lastName = (form.lastname || "").trim();
  const username = (form.username || "").trim();
  const email = (form.email || "").trim().toLowerCase();
  const phone = (form.phone || "").trim();
  const gender = (form.gender || "").trim();
  const dob = (form.acct_dob || "").trim();
  const country = (form.acct_country_name || form.acct_country || "").trim();
  const state = (form.state || "").trim();
  const zipCode = (form.zip_code || "").trim();
  const maritalStatus = (form.marital_status || "").trim();
  const ssn = (form.acct_ssn || "").trim();
  const occupation = (form.occupation || "").trim();
  const address = (form.address || "").trim();
  const profileImage = sanitizeProfileImageUrl(form.profile_image);
  const password = form.password || "";
  const confirmPassword = form.confirm_password || "";

  if (!firstName || !lastName || !username || !email || !phone || !password) {
    return redirect(res, "/register.html?error=Please+complete+all+required+fields");
  }
  if (!isValidEmail(email)) {
    return redirect(res, "/register.html?error=Enter+a+valid+email+address");
  }
  if (password !== confirmPassword) {
    return redirect(res, "/register.html?error=Passwords+do+not+match");
  }
  if (password.length < 8) {
    return redirect(res, "/register.html?error=Password+must+be+at+least+8+characters");
  }

  const accountNumber = await nextAccountNumber();
  const passwordHash = hashPassword(password);

  try {
    const result = await dbRun(createUserSql, [
      accountNumber,
      firstName,
      lastName,
      username,
      email,
      phone,
      gender,
      dob,
      country,
      state,
      zipCode,
      maritalStatus,
      ssn,
      occupation,
      address,
      profileImage,
      "USD",
      "pending_transfer",
      "",
      "",
      "",
      passwordHash,
    ]);

    const userId = Number(result.lastInsertRowid);
    await createTransaction(userId, {
      referenceId: nextReference("DP"),
      category: "deposit",
      type: "credit",
      description: "Opening Balance",
      amount: 0,
      status: "Completed",
      currencyCode: "USD",
    });

    const sessionToken = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    await dbRun("INSERT INTO sessions (session_token, user_id, expires_at, insurance_verified) VALUES ($1, $2, $3, $4)", [sessionToken, userId, expiresAt, 0]);

    res.writeHead(302, {
      Location: "/insurance-code?success=Account+created+successfully",
      "Set-Cookie": cookieHeader("session", sessionToken, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7,
        path: "/",
        sameSite: "Lax",
        secure: IS_PRODUCTION,
      }),
    });
    res.end();
  } catch (error) {
    const message = String(error.message || "");
    if (message.includes("users.username")) {
      return redirect(res, "/register.html?error=Username+already+exists");
    }
    if (message.includes("users.email")) {
      return redirect(res, "/register.html?error=Email+already+exists");
    }
    return redirect(res, "/register.html?error=Registration+failed");
  }
}

async function handleLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (cookies.session) {
    await dbRun("DELETE FROM sessions WHERE session_token = $1", [cookies.session]);
  }

  res.writeHead(302, {
    Location: "/auth/login.html?success=Signed+out+successfully",
    "Set-Cookie": cookieHeader("session", "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: IS_PRODUCTION,
    }),
  });
  res.end();
}

async function handleAdminLogin(res, form) {
  const username = String(form.username || "").trim();
  const password = String(form.password || "");
  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return redirect(res, "/admin-backoffice/login.html?error=Invalid+admin+credentials");
  }

  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
  await dbRun("INSERT INTO admin_sessions (session_token, username, expires_at) VALUES ($1, $2, $3)", [token, username, expiresAt]);
  res.writeHead(302, {
    Location: "/admin-backoffice",
    "Set-Cookie": cookieHeader("admin_session", token, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
      sameSite: "Lax",
      secure: IS_PRODUCTION,
    }),
  });
  res.end();
}

async function handleAdminLogout(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (cookies.admin_session) {
    await dbRun("DELETE FROM admin_sessions WHERE session_token = $1", [cookies.admin_session]);
  }

  res.writeHead(302, {
    Location: "/admin-backoffice/login.html?success=Signed+out+successfully",
    "Set-Cookie": cookieHeader("admin_session", "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "Lax",
      secure: IS_PRODUCTION,
    }),
  });
  res.end();
}

async function handleDeposit(req, res, form) {
  const session = await requireSession(req, res);
  if (!session) {
    return;
  }
  const amount = Number(form.amount || 0);
  if (!(amount > 0)) {
    return redirect(res, "/deposit?error=Enter+a+valid+deposit+amount");
  }

  await createTransaction(session.id, {
    referenceId: nextReference("DP"),
    category: "deposit",
    type: "credit",
    description: "Customer deposit request",
    amount,
    status: "Pending",
    currencyCode: session.preferred_currency || "USD",
    metadata: {
      method: form.method || "Bank Transfer",
      note: form.note || "",
    },
  });
  redirect(res, "/deposit?success=Deposit+request+submitted");
}

async function handleWireTransfer(req, res, form) {
  const session = await requireSession(req, res);
  if (!session) {
    return;
  }
  const amount = Number(form.amount || 0);
  const beneficiaryName = String(form.beneficiary_name || "").trim();
  const bankName = String(form.bank_name || "").trim();
  const accountNumber = String(form.account_number || "").trim();
  const accountType = String(form.account_type || "").trim();
  const otpCode = String(form.otp_code || "").trim();
  const fdicCode = String(form.fdic_code || "").trim();
  const bankingCode = String(form.banking_code || "").trim();
  if (!(amount > 0) || !beneficiaryName || !bankName || !accountNumber || !accountType) {
    return redirect(res, "/wire-transfer?error=Complete+the+wire+transfer+form");
  }
  const approvedOtpCode = String(session.transfer_otp_code || "").trim();
  if (!/^\d{6}$/.test(approvedOtpCode)) {
    return redirect(res, "/wire-transfer?error=Transfer+OTP+is+not+configured.+Please+contact+support");
  }
  const transferFlowState = normalizeTransferFlowState(session.transfer_flow_state);
  if (transferFlowState === "invalid_otp" || otpCode !== approvedOtpCode) {
    return redirect(res, "/wire-transfer?error=Invalid+OTP+code&transfer_state=invalid_otp&resume_transfer=1");
  }

  const requiredFdicCode = String(session.transfer_fdic_code || "").trim();
  if (requiredFdicCode && fdicCode !== requiredFdicCode) {
    return redirect(res, "/wire-transfer?error=Invalid+FDIC+Insurance+Code&resume_transfer=1");
  }

  const requiredBankingCode = String(session.transfer_banking_code || "").trim();
  if (requiredBankingCode && bankingCode !== requiredBankingCode) {
    return redirect(res, "/wire-transfer?error=Invalid+Banking+Code&resume_transfer=1");
  }

  await createTransaction(session.id, {
    referenceId: nextReference("WT"),
    category: "wire_transfer",
    type: "debit",
    description: `Wire transfer to ${beneficiaryName}`,
    amount: -Math.abs(amount),
    status: transferFlowState === "transfer_completed" ? "Completed" : "Pending",
    currencyCode: (form.currency_code || session.preferred_currency || "USD").trim(),
    metadata: {
      beneficiaryName,
      bankName,
      accountNumber,
      beneficiaryAddress: form.beneficiary_address || "",
      beneficiaryBankAddress: form.beneficiary_bank_address || "",
      country: form.country || "",
      swiftCode: form.swift_code || "",
      routingNumber: form.routing_number || "",
      accountType,
      narration: form.narration || "",
    },
  });
  if (transferFlowState === "transfer_completed") {
    return redirect(res, "/wire-transfer?success=Transfer+completed+successfully&transfer_state=transfer_completed");
  }
  redirect(res, "/wire-transfer?success=Transfer+is+pending+approval&transfer_state=pending_transfer");
}

async function handleDomesticTransfer(req, res, form) {
  const session = await requireSession(req, res);
  if (!session) {
    return;
  }
  const amount = Number(form.amount || 0);
  const beneficiaryName = String(form.beneficiary_name || "").trim();
  const bankName = String(form.bank_name || "").trim();
  const accountNumber = String(form.account_number || "").trim();
  const accountType = String(form.account_type || "").trim();
  const otpCode = String(form.otp_code || "").trim();
  const fdicCode = String(form.fdic_code || "").trim();
  const bankingCode = String(form.banking_code || "").trim();
  if (!(amount > 0) || !beneficiaryName || !bankName || !accountNumber || !accountType) {
    return redirect(res, "/dom-transfer?error=Complete+the+domestic+transfer+form");
  }
  const approvedOtpCode = String(session.transfer_otp_code || "").trim();
  if (!/^\d{6}$/.test(approvedOtpCode)) {
    return redirect(res, "/dom-transfer?error=Transfer+OTP+is+not+configured.+Please+contact+support");
  }
  const transferFlowState = normalizeTransferFlowState(session.transfer_flow_state);
  if (transferFlowState === "invalid_otp" || otpCode !== approvedOtpCode) {
    return redirect(res, "/dom-transfer?error=Invalid+OTP+code&transfer_state=invalid_otp&resume_transfer=1");
  }

  const requiredFdicCode = String(session.transfer_fdic_code || "").trim();
  if (requiredFdicCode && fdicCode !== requiredFdicCode) {
    return redirect(res, "/dom-transfer?error=Invalid+FDIC+Insurance+Code&resume_transfer=1");
  }

  const requiredBankingCode = String(session.transfer_banking_code || "").trim();
  if (requiredBankingCode && bankingCode !== requiredBankingCode) {
    return redirect(res, "/dom-transfer?error=Invalid+Banking+Code&resume_transfer=1");
  }

  await createTransaction(session.id, {
    referenceId: nextReference("DT"),
    category: "domestic_transfer",
    type: "debit",
    description: `Domestic transfer to ${beneficiaryName}`,
    amount: -Math.abs(amount),
    status: transferFlowState === "transfer_completed" ? "Completed" : "Pending",
    currencyCode: (form.currency_code || session.preferred_currency || "USD").trim(),
    metadata: {
      beneficiaryName,
      bankName,
      accountNumber,
      beneficiaryAddress: form.beneficiary_address || "",
      beneficiaryBankAddress: form.beneficiary_bank_address || "",
      accountType,
      narration: form.narration || "",
    },
  });
  if (transferFlowState === "transfer_completed") {
    return redirect(res, "/dom-transfer?success=Transfer+completed+successfully&transfer_state=transfer_completed");
  }
  redirect(res, "/dom-transfer?success=Transfer+is+pending+approval&transfer_state=pending_transfer");
}

async function handleLoan(req, res, form) {
  const session = await requireSession(req, res);
  if (!session) {
    return;
  }
  const amount = Number(form.amount || 0);
  const duration = String(form.duration || "").trim();
  const reason = String(form.reason || "").trim();
  if (!(amount > 0) || !duration || !reason) {
    return redirect(res, "/loan?error=Complete+the+loan+application+form");
  }

  await dbRun(createLoanSql, [
    session.id,
    amount,
    duration,
    reason,
    "Pending",
    nowSql()
  ]);
  redirect(res, "/loan?success=Loan+application+submitted");
}

async function handleProfileUpdate(req, res, form) {
  const session = await requireSession(req, res);
  if (!session) {
    return;
  }

  try {
    await applyUploadedProfileImage(form);
  } catch (error) {
    return redirect(res, `/profile?error=${encodeURIComponent(error.message)}`);
  }

  const payload = await sanitizeUserPayload(form, { requirePassword: false, allowBlankPassword: true });
  payload.firstName = session.first_name;
  payload.lastName = session.last_name;
  payload.username = session.username;
  payload.accountNumber = session.account_number;
  payload.ssn = session.ssn || "";

  if (!payload.email || !payload.phone) {
    return redirect(res, "/profile?error=Email+and+phone+are+required");
  }

  if (!isValidEmail(payload.email)) {
    return redirect(res, "/profile?error=Enter+a+valid+email+address");
  }

  const emailOwner = await dbGet("SELECT id FROM users WHERE email = $1", [payload.email]);
  if (emailOwner && Number(emailOwner.id) !== Number(session.id)) {
    return redirect(res, "/profile?error=Email+address+already+exists");
  }

  try {
    await dbRun(
      `UPDATE users
       SET first_name = $1, last_name = $2, email = $3, phone = $4, gender = $5, date_of_birth = $6, country = $7, state = $8, zip_code = $9, marital_status = $10, occupation = $11, address = $12, profile_image = $13, preferred_currency = $14
       WHERE id = $15`,
      [
      payload.firstName,
      payload.lastName,
      payload.email,
      payload.phone,
      payload.gender,
      payload.dateOfBirth,
      payload.country,
      payload.state,
      payload.zipCode,
      payload.maritalStatus,
      payload.occupation,
      payload.address,
      payload.profileImage,
      payload.preferredCurrency,
      session.id
      ]
    );
  } catch (error) {
    return redirect(res, "/profile?error=Unable+to+update+profile");
  }

  redirect(res, "/profile?success=Profile+updated+successfully");
}

async function handlePortalData(req, res) {
  const session = await getVerifiedSessionUser(req);
  if (!session) {
    return respondJson(res, 401, { error: "Unauthorized" });
  }

  const allTransactions = (await dbAll(`
    SELECT id, reference_id, category, type, description, amount, status, currency_code, created_at, metadata_json
    FROM transactions
    WHERE user_id = $1
    ORDER BY created_at DESC, id DESC
  `, [session.id])).map(normalizeTransaction);
  const recentTransactions = (await dbAll(`
    SELECT id, reference_id, category, type, description, amount, status, currency_code, created_at, metadata_json
    FROM transactions
    WHERE user_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 8
  `, [session.id])).map(normalizeTransaction);
  const loans = await dbAll(`
    SELECT id, amount, duration, reason, status, created_at
    FROM loan_applications
    WHERE user_id = $1
    ORDER BY created_at DESC, id DESC
  `, [session.id]);
  const latestLoan = await dbGet(`
    SELECT amount, duration, reason, status, created_at
    FROM loan_applications
    WHERE user_id = $1
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `, [session.id]);

  const completedCredits = allTransactions
    .filter((entry) => entry.type === "credit" && entry.status === "Completed")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const completedDebits = allTransactions
    .filter((entry) => entry.type === "debit" && entry.status === "Completed")
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);
  const availableBalance = completedCredits - completedDebits;
  const pendingDeposits = allTransactions
    .filter((entry) => entry.category === "deposit" && entry.status === "Pending")
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

  respondJson(res, 200, {
    user: {
      id: session.id,
      accountNumber: session.account_number,
      firstName: session.first_name,
      lastName: session.last_name,
      fullName: `${session.first_name} ${session.last_name}`,
      username: session.username,
      email: session.email,
      phone: session.phone,
      gender: session.gender,
      dateOfBirth: session.date_of_birth,
      country: session.country,
      state: session.state,
      zipCode: session.zip_code,
      maritalStatus: session.marital_status,
      ssn: session.ssn,
      occupation: session.occupation,
      address: session.address,
      profileImage: session.profile_image || "",
      preferredCurrency: session.preferred_currency || "USD",
      createdAt: session.created_at,
    },
    summary: {
      availableBalance,
      pendingDeposits,
      transactionCount: allTransactions.length,
      loanAmount: latestLoan ? Number(latestLoan.amount) : 0,
      loanStatus: latestLoan ? latestLoan.status : "None",
    },
    chart: buildChartSeries(allTransactions),
    recentTransactions,
    transactions: allTransactions,
    loans,
    quickTransferTargets: [
      "Citibank *6382",
      "Chase *8372",
      "Bank of America *7363",
    ],
  });
}

async function serveInsuranceCodePage(req, res) {
  const session = await getSessionUser(req);
  if (!session) {
    return redirect(res, "/auth/login.html?error=Please+sign+in+first");
  }
  if (Number(session.insurance_verified) === 1) {
    return redirect(res, "/dashboard");
  }
  return serveFile(res, path.join(ROOT, "auth", "insurance-code.html"));
}

async function handleInsuranceCodeSubmit(req, res, form) {
  const session = await getSessionUser(req);
  if (!session) {
    return redirect(res, "/auth/login.html?error=Please+sign+in+first");
  }

  const enteredCode = String(form.insurance_code || form.code || "").trim().toUpperCase();
  if (enteredCode !== INSURANCE_CODE) {
    return redirect(res, "/insurance-code?error=Invalid+insurance+code");
  }

  await dbRun("UPDATE sessions SET insurance_verified = 1 WHERE session_token = $1", [session.session_token]);
  return redirect(res, "/dashboard");
}

async function handleAdminData(req, res) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  const users = (await dbAll(`
    SELECT id, account_number, first_name, last_name, username, email, phone, gender, date_of_birth,
           country, state, zip_code, marital_status, ssn, occupation, address, profile_image, preferred_currency, transfer_flow_state, transfer_otp_code, transfer_fdic_code, transfer_banking_code, created_at
    FROM users
    ORDER BY id ASC
  `)).map((user) => ({
    ...user,
    display_name: `${user.first_name} ${user.last_name}`,
  }));
  const transactions = (await dbAll(`
    SELECT transactions.id, transactions.user_id, users.account_number, users.first_name, users.last_name,
           transactions.reference_id, transactions.category, transactions.type, transactions.description,
           transactions.amount, transactions.status, transactions.currency_code, transactions.created_at
    FROM transactions
    JOIN users ON users.id = transactions.user_id
    ORDER BY transactions.created_at DESC, transactions.id DESC
  `)).map((item) => ({
    ...item,
    display_name: `${item.first_name} ${item.last_name}`,
  }));
  const loans = (await dbAll(`
    SELECT loan_applications.id, loan_applications.user_id, users.account_number, users.first_name, users.last_name,
           loan_applications.amount, loan_applications.duration, loan_applications.reason, loan_applications.status,
           loan_applications.created_at
    FROM loan_applications
    JOIN users ON users.id = loan_applications.user_id
    ORDER BY loan_applications.created_at DESC, loan_applications.id DESC
  `)).map((item) => ({
    ...item,
    display_name: `${item.first_name} ${item.last_name}`,
  }));

  respondJson(res, 200, { users, transactions, loans });
}

async function handleAdminCreateUser(req, res, form) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  try {
    await applyUploadedProfileImage(form);
    const payload = await sanitizeUserPayload(form, { allowBlankPassword: false });
    const validationError = await validateAdminUserPayload(payload);
    if (validationError) {
      return respondJson(res, 400, { error: validationError });
    }

    const result = await dbRun(createUserSql, [
      payload.accountNumber,
      payload.firstName,
      payload.lastName,
      payload.username,
      payload.email,
      payload.phone,
      payload.gender,
      payload.dateOfBirth,
      payload.country,
      payload.state,
      payload.zipCode,
      payload.maritalStatus,
      payload.ssn,
      payload.occupation,
      payload.address,
      payload.profileImage,
      payload.preferredCurrency,
      payload.transferFlowState,
      payload.transferOtpCode,
      payload.transferFdicCode,
      payload.transferBankingCode,
      hashPassword(payload.password),
    ]);

    await createTransaction(Number(result.lastInsertRowid), {
      referenceId: nextReference("OPN"),
      category: "deposit",
      type: "credit",
      description: "Opening Balance",
      amount: Number(form.opening_balance || 0),
      status: "Completed",
      currencyCode: payload.preferredCurrency,
    });

    respondJson(res, 200, {
      success: true,
      userId: Number(result.lastInsertRowid),
      accountNumber: payload.accountNumber,
    });
  } catch (error) {
    respondJson(res, 400, { error: mapSqlUserError(error, "Unable to create user") });
  }
}

async function handleAdminUpdateUser(req, res, form) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  const userId = Number(form.id || 0);
  if (!userId) {
    return respondJson(res, 400, { error: "Invalid user id" });
  }

  const existingUser = await getUserById(userId);
  if (!existingUser) {
    return respondJson(res, 404, { error: "User not found" });
  }

  try {
    await applyUploadedProfileImage(form);
  } catch (error) {
    return respondJson(res, 400, { error: error.message });
  }

  const payload = await sanitizeUserPayload(form, { requirePassword: false, allowBlankPassword: true });
  payload.accountNumber = payload.accountNumber || existingUser.account_number;
  payload.firstName = payload.firstName || existingUser.first_name;
  payload.lastName = payload.lastName || existingUser.last_name;
  payload.username = payload.username || existingUser.username;
  payload.email = payload.email || existingUser.email;
  payload.phone = payload.phone || existingUser.phone;
  payload.gender = payload.gender || existingUser.gender || "";
  payload.dateOfBirth = payload.dateOfBirth || existingUser.date_of_birth || "";
  payload.country = payload.country || existingUser.country || "";
  payload.state = payload.state || existingUser.state || "";
  payload.zipCode = payload.zipCode || existingUser.zip_code || "";
  payload.maritalStatus = payload.maritalStatus || existingUser.marital_status || "";
  payload.ssn = payload.ssn || existingUser.ssn || "";
  payload.occupation = payload.occupation || existingUser.occupation || "";
  payload.address = payload.address || existingUser.address || "";
  if (!Object.prototype.hasOwnProperty.call(form, "profile_image")) {
    payload.profileImage = existingUser.profile_image || "";
  }
  payload.preferredCurrency = payload.preferredCurrency || existingUser.preferred_currency || "USD";
  payload.transferFlowState = payload.transferFlowState || existingUser.transfer_flow_state || "pending_transfer";
  payload.transferOtpCode = payload.transferOtpCode || existingUser.transfer_otp_code || "";
  if (!Object.prototype.hasOwnProperty.call(form, "transfer_fdic_code")) {
    payload.transferFdicCode = existingUser.transfer_fdic_code || "";
  }
  if (!Object.prototype.hasOwnProperty.call(form, "transfer_banking_code")) {
    payload.transferBankingCode = existingUser.transfer_banking_code || "";
  }

  const validationError = await validateAdminUserPayload(payload, userId, existingUser.account_number);
  if (validationError) {
    return respondJson(res, 400, { error: validationError });
  }

  try {
    await dbRun(
      `UPDATE users
       SET account_number = $1, first_name = $2, last_name = $3, username = $4, email = $5, phone = $6, gender = $7, date_of_birth = $8, country = $9, state = $10, zip_code = $11, marital_status = $12, ssn = $13, occupation = $14, address = $15, profile_image = $16, preferred_currency = $17, transfer_flow_state = $18, transfer_otp_code = $19, transfer_fdic_code = $20, transfer_banking_code = $21
       WHERE id = $22`,
      [
        payload.accountNumber,
        payload.firstName,
        payload.lastName,
        payload.username,
        payload.email,
        payload.phone,
        payload.gender,
        payload.dateOfBirth,
        payload.country,
        payload.state,
        payload.zipCode,
        payload.maritalStatus,
        payload.ssn,
        payload.occupation,
        payload.address,
        payload.profileImage,
        payload.preferredCurrency,
        payload.transferFlowState,
        payload.transferOtpCode,
        payload.transferFdicCode,
        payload.transferBankingCode,
        userId,
      ]
    );

    if (payload.password) {
      if (payload.password.length < 8) {
        return respondJson(res, 400, { error: "Password must be at least 8 characters" });
      }
      await dbRun("UPDATE users SET password_hash = $1 WHERE id = $2", [hashPassword(payload.password), userId]);
    }
  } catch (error) {
    return respondJson(res, 400, { error: mapSqlUserError(error, "Unable to update user") });
  }

  respondJson(res, 200, { success: true });
}

async function handleAdminDeleteUser(req, res, form) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  const userId = Number(form.id || 0);
  if (!userId) {
    return respondJson(res, 400, { error: "Invalid user id" });
  }

  const existingUser = await getUserById(userId);
  if (!existingUser) {
    return respondJson(res, 404, { error: "User not found" });
  }

  await dbRun("DELETE FROM users WHERE id = $1", [userId]);
  respondJson(res, 200, { success: true });
}

async function handleAdminAdjustBalance(req, res, form) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  const userId = Number(form.user_id || 0);
  const amount = Number(form.amount || 0);
  if (!userId || !amount) {
    return respondJson(res, 400, { error: "Invalid adjustment" });
  }

  await createTransaction(userId, {
    referenceId: nextReference("ADJ"),
    category: "adjustment",
    type: amount >= 0 ? "credit" : "debit",
    description: String(form.description || "Admin balance adjustment").trim(),
    amount,
    status: String(form.status || "Completed").trim() || "Completed",
    currencyCode: String(form.currency_code || "USD").trim().toUpperCase(),
  });

  respondJson(res, 200, { success: true });
}

async function handleAdminCreateTransaction(req, res, form) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  const userId = Number(form.user_id || 0);
  if (!userId) {
    return respondJson(res, 400, { error: "Invalid user id" });
  }

  const user = await getUserById(userId);
  if (!user) {
    return respondJson(res, 404, { error: "User not found" });
  }

  const type = String(form.type || "").trim().toLowerCase();
  if (type !== "credit" && type !== "debit") {
    return respondJson(res, 400, { error: "Transaction type must be credit or debit" });
  }

  const rawAmount = Number(form.amount || 0);
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return respondJson(res, 400, { error: "Transaction amount must be greater than zero" });
  }

  const description = String(form.description || "").trim();
  if (!description) {
    return respondJson(res, 400, { error: "Transaction description is required" });
  }

  const status = String(form.status || "Completed").trim() || "Completed";
  const currencyCode = String(form.currency_code || user.preferred_currency || "USD").trim().toUpperCase();
  const referenceId = String(form.reference_id || "").trim() || nextReference(type === "credit" ? "CR" : "DB");
  const category = String(form.category || "").trim() || "manual_entry";
  const createdAt = normalizeSqlDateTime(form.created_at);

  await createTransaction(userId, {
    referenceId,
    category,
    type,
    description,
    amount: type === "debit" ? -Math.abs(rawAmount) : Math.abs(rawAmount),
    status,
    currencyCode,
    createdAt,
  });

  respondJson(res, 200, { success: true });
}

async function handleAdminUpdateTransaction(req, res, form) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  const transactionId = Number(form.id || 0);
  if (!transactionId) {
    return respondJson(res, 400, { error: "Invalid transaction id" });
  }

  const amount = Number(form.amount || 0);
  if (!Number.isFinite(amount)) {
    return respondJson(res, 400, { error: "Invalid transaction amount" });
  }

  await dbRun(
    `UPDATE transactions
     SET reference_id = $1, category = $2, type = $3, description = $4, amount = $5, status = $6, currency_code = $7
     WHERE id = $8`,
    [
      String(form.reference_id || "").trim(),
      String(form.category || "").trim(),
      String(form.type || "").trim(),
      String(form.description || "").trim(),
      amount,
      String(form.status || "").trim(),
      String(form.currency_code || "USD").trim().toUpperCase(),
      transactionId,
    ]
  );

  respondJson(res, 200, { success: true });
}

async function handleAdminUpdateLoan(req, res, form) {
  const adminSession = await requireAdmin(req, res, true);
  if (!adminSession) {
    return;
  }

  const loanId = Number(form.id || 0);
  if (!loanId) {
    return respondJson(res, 400, { error: "Invalid loan id" });
  }

  await dbRun("UPDATE loan_applications SET status = $1 WHERE id = $2", [String(form.status || "").trim() || "Pending", loanId]);
  respondJson(res, 200, { success: true });
}

function handleStates(res, countryId) {
  respondJson(res, 200, {
    states: COUNTRY_STATES[countryId] || ["Central", "West", "East", "North"],
  });
}

async function requireSession(req, res) {
  const session = await getSessionUser(req);
  if (!session) {
    redirect(res, "/auth/login.html?error=Please+sign+in+first");
    return null;
  }
  return session;
}

async function requireAdmin(req, res, isApi = false) {
  const session = await getAdminSession(req);
  if (!session) {
    if (isApi) {
      respondJson(res, 401, { error: "Unauthorized" });
    } else {
      redirect(res, "/admin-backoffice/login.html?error=Please+sign+in+as+admin");
    }
    return null;
  }
  return session;
}

async function getSessionUser(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (!cookies.session) {
    return null;
  }

  const session = await dbGet(`
    SELECT sessions.session_token, sessions.expires_at, sessions.insurance_verified, users.*
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.session_token = $1
  `, [cookies.session]);
  if (!session) {
    return null;
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await dbRun("DELETE FROM sessions WHERE session_token = $1", [cookies.session]);
    return null;
  }

  return session;
}

async function getVerifiedSessionUser(req) {
  const session = await getSessionUser(req);
  if (!session) {
    return null;
  }
  if (Number(session.insurance_verified) !== 1) {
    return null;
  }
  return session;
}

async function getAdminSession(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (!cookies.admin_session) {
    return null;
  }

  const session = await dbGet("SELECT * FROM admin_sessions WHERE session_token = $1", [cookies.admin_session]);
  if (!session) {
    return null;
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    await dbRun("DELETE FROM admin_sessions WHERE session_token = $1", [cookies.admin_session]);
    return null;
  }

  return session;
}

async function createTransaction(userId, { referenceId, category, type, description, amount, status, currencyCode, createdAt, metadata }) {
  await dbRun(createTransactionSql, [
    userId,
    referenceId || nextReference(category === "deposit" ? "DP" : "TX"),
    category || type,
    type,
    description,
    amount,
    status || "Pending",
    currencyCode || "USD",
    createdAt || nowSql(),
    metadata ? JSON.stringify(metadata) : null
  ]);
}

function normalizeTransaction(entry) {
  let metadata = {};
  try {
    metadata = entry.metadata_json ? JSON.parse(entry.metadata_json) : {};
  } catch (error) {
    metadata = {};
  }
  return {
    ...entry,
    amount: Number(entry.amount),
    currency_code: entry.currency_code || "USD",
    reference_id: entry.reference_id || `TX${String(entry.id).padStart(3, "0")}`,
    category: entry.category || entry.type,
    metadata,
  };
}

function buildChartSeries(transactions) {
  const completed = transactions
    .filter((entry) => entry.status === "Completed")
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const labels = [];
  const values = [];
  let running = 0;

  for (const entry of completed) {
    running += entry.amount;
    labels.push(entry.created_at.slice(5, 10));
    values.push(Number(running.toFixed(2)));
  }

  if (!values.length) {
    return {
      labels: ["Start"],
      values: [0],
    };
  }

  return { labels, values };
}

function collectForm(req, res, callback) {
  const chunks = [];
  let total = 0;
  req.on("data", (chunk) => {
    total += chunk.length;
    if (total > MAX_FORM_BYTES) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => {
    Promise.resolve(parseRequestForm(req, Buffer.concat(chunks)))
      .then((form) => callback(form))
      .catch((error) => {
      console.error(error);
      respondText(res, 500, "Internal Server Error");
    });
  });
}

async function parseRequestForm(req, body) {
  const contentType = req.headers["content-type"] || "";
  if (/multipart\/form-data/i.test(contentType)) {
    return parseMultipartForm(body, contentType);
  }
  return Object.fromEntries(new URLSearchParams(body.toString()));
}

function parseMultipartForm(body, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new Error("Missing multipart boundary");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const form = {};
  const files = {};
  let cursor = 0;

  while (cursor < body.length) {
    const boundaryStart = body.indexOf(boundary, cursor);
    if (boundaryStart === -1) break;
    const partStart = boundaryStart + boundary.length;
    if (body[partStart] === 45 && body[partStart + 1] === 45) break;

    const contentStart = body.indexOf(Buffer.from("\r\n\r\n"), partStart);
    if (contentStart === -1) break;
    const headerText = body.slice(partStart + 2, contentStart).toString("utf8");
    let nextBoundary = body.indexOf(boundary, contentStart + 4);
    if (nextBoundary === -1) nextBoundary = body.length;

    let contentEnd = nextBoundary;
    if (body[contentEnd - 2] === 13 && body[contentEnd - 1] === 10) {
      contentEnd -= 2;
    }
    const content = body.slice(contentStart + 4, contentEnd);
    const nameMatch = headerText.match(/name="([^"]+)"/i);
    if (!nameMatch) {
      cursor = nextBoundary;
      continue;
    }

    const filenameMatch = headerText.match(/filename="([^"]*)"/i);
    const contentTypeMatch = headerText.match(/content-type:\s*([^\r\n]+)/i);
    const name = nameMatch[1];

    if (filenameMatch && filenameMatch[1]) {
      files[name] = {
        filename: path.basename(filenameMatch[1]),
        contentType: contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : "",
        buffer: content,
      };
    } else {
      form[name] = content.toString("utf8");
    }

    cursor = nextBoundary;
  }

  Object.defineProperty(form, "__files", {
    value: files,
    enumerable: false,
  });
  return form;
}

async function nextAccountNumber() {
  const row = await dbGet("SELECT account_number FROM users ORDER BY id DESC LIMIT 1");
  const current = row ? Number(row.account_number) : 0;
  const next = Math.max(current, 999999999) + 1;
  return String(next).padStart(10, "0");
}

function nextReference(prefix) {
  const random = Math.floor(100 + Math.random() * 900);
  return `${prefix}${random}`;
}

function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function normalizeSqlDateTime(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return nowSql();
  }
  const candidate = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(candidate);
  if (Number.isNaN(date.getTime())) {
    return nowSql();
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19).replace("T", " ");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, originalHash] = String(stored).split(":");
  if (!salt || !originalHash) {
    return false;
  }
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(originalHash, "hex"));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[ext] || "application/octet-stream";
  if (ext === ".html") {
    const html = fs.readFileSync(filePath, "utf8");
    const injected = injectSiteScript(html);
    res.writeHead(200, { "Content-Type": type });
    res.end(injected);
    return;
  }
  res.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

function injectSiteScript(html) {
  const snippet = `
<script type="text/javascript">
var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
(function(){
var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
s1.async=true;
s1.src='https://embed.tawk.to/69cbcf01be444a1c3a7ff082/1jl2217ov';
s1.charset='UTF-8';
s1.setAttribute('crossorigin','*');
s0.parentNode.insertBefore(s1,s0);
})();
</script>
`;
  if (html.includes("embed.tawk.to/69cbcf01be444a1c3a7ff082/1jl2217ov")) {
    return html;
  }
  return html.replace(/<\/body>/i, `${snippet}</body>`);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function respondText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseCookies(cookieHeader) {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, entry) => {
      const index = entry.indexOf("=");
      const key = index >= 0 ? entry.slice(0, index) : entry;
      const value = index >= 0 ? entry.slice(index + 1) : "";
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function cookieHeader(name, value, options) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

async function sanitizeUserPayload(form, options = {}) {
  const password = String(form.password || "").trim();
  const accountNumber = String(form.account_number || "").replace(/\D/g, "").slice(0, 10).trim() || await nextAccountNumber();
  return {
    accountNumber,
    firstName: String(form.first_name || form.firstname || "").trim(),
    lastName: String(form.last_name || form.lastname || "").trim(),
    username: String(form.username || "").trim(),
    email: String(form.email || "").trim().toLowerCase(),
    phone: String(form.phone || "").trim(),
    gender: String(form.gender || "").trim(),
    dateOfBirth: String(form.date_of_birth || form.acct_dob || "").trim(),
    country: String(form.country || form.acct_country_name || form.acct_country || "").trim(),
    state: String(form.state || "").trim(),
    zipCode: String(form.zip_code || "").trim(),
    maritalStatus: String(form.marital_status || "").trim(),
    ssn: String(form.ssn || form.acct_ssn || "").trim(),
    occupation: String(form.occupation || "").trim(),
    address: String(form.address || "").trim(),
    profileImage: sanitizeProfileImageUrl(form.profile_image),
    preferredCurrency: String(form.preferred_currency || "USD").trim().toUpperCase(),
    transferFlowState: normalizeTransferFlowState(form.transfer_flow_state),
    transferOtpCode: String(form.transfer_otp_code || "").trim(),
    transferFdicCode: String(form.transfer_fdic_code || "").trim(),
    transferBankingCode: String(form.transfer_banking_code || "").trim(),
    password: options.allowBlankPassword ? password : password,
  };
}

function sanitizeProfileImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\/[^\s"<>]+$/i.test(raw)) return raw;
  if (/^\/(?:assets|admin\/assets)\/[^\s"<>]+$/i.test(raw)) return raw;
  if (/^\/uploads\/avatars\/[a-z0-9_.-]+$/i.test(raw)) return raw;
  return "";
}

async function applyUploadedProfileImage(form) {
  const file = form.__files && form.__files.profile_image_file;
  if (!file || !file.buffer || !file.buffer.length) {
    return;
  }

  const allowedTypes = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ]);
  const extension = allowedTypes.get(file.contentType);
  if (!extension) {
    throw new Error("Profile image must be a JPEG, PNG, or WebP file");
  }
  if (file.buffer.length > 2 * 1024 * 1024) {
    throw new Error("Profile image must be 2MB or smaller");
  }

  await fs.promises.mkdir(AVATAR_UPLOAD_DIR, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${extension}`;
  await fs.promises.writeFile(path.join(AVATAR_UPLOAD_DIR, filename), file.buffer);
  form.profile_image = `/uploads/avatars/${filename}`;
}

async function validateAdminUserPayload(payload, currentUserId = null, existingAccountNumber = "") {
  if (!payload.firstName || !payload.lastName || !payload.username || !payload.email || !payload.phone) {
    return "First name, last name, username, email, and phone are required";
  }
  if (payload.accountNumber !== existingAccountNumber && !/^\d{1,10}$/.test(payload.accountNumber)) {
    return "Account number must be up to 10 digits";
  }
  if (!isValidEmail(payload.email)) {
    return "Enter a valid email address";
  }
  if (payload.password && payload.password.length < 8) {
    return "Password must be at least 8 characters";
  }
  if (!["invalid_otp", "pending_transfer", "transfer_completed"].includes(payload.transferFlowState)) {
    return "Select a valid transfer flow";
  }
  if (!/^\d{6}$/.test(payload.transferOtpCode)) {
    return "Transfer OTP must be exactly 6 digits";
  }
  const usernameOwner = await dbGet("SELECT id FROM users WHERE username = $1", [payload.username]);
  if (usernameOwner && Number(usernameOwner.id) !== Number(currentUserId)) {
    return "Username already exists";
  }
  const emailOwner = await dbGet("SELECT id FROM users WHERE email = $1", [payload.email]);
  if (emailOwner && Number(emailOwner.id) !== Number(currentUserId)) {
    return "Email already exists";
  }
  const accountOwner = await dbGet("SELECT id FROM users WHERE account_number = $1", [payload.accountNumber]);
  if (accountOwner && Number(accountOwner.id) !== Number(currentUserId)) {
    return "Account number already exists";
  }
  return "";
}

function normalizeTransferFlowState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "invalid_otp" || normalized === "pending_transfer" || normalized === "transfer_completed") {
    return normalized;
  }
  return "pending_transfer";
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function mapSqlUserError(error, fallback) {
  const message = String(error && error.message ? error.message : "");
  if (message.includes("users.username") || message.includes("users_username_key")) {
    return "Username already exists";
  }
  if (message.includes("users.email") || message.includes("users_email_key")) {
    return "Email already exists";
  }
  if (message.includes("users.account_number") || message.includes("users_account_number_key")) {
    return "Account number already exists";
  }
  return fallback;
}

async function getUserById(userId) {
  return dbGet("SELECT * FROM users WHERE id = $1", [userId]);
}

function safeJoin(root, requestedPath) {
  const resolved = path.normalize(path.join(root, requestedPath));
  if (!resolved.startsWith(root)) {
    return null;
  }
  return resolved;
}

function isPubliclyBlockedPath(requestPath) {
  if (PUBLIC_DENYLIST.has(requestPath)) {
    return true;
  }
  return PUBLIC_DENYLIST_PREFIXES.some((prefix) => requestPath.startsWith(prefix));
}
