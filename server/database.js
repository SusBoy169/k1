const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Determine the path for the database file (e.g., in the server directory)
const dbPath = path.resolve(__dirname, 'chat.db');

// Create a new database connection
// The database is created if it does not exist
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to SQLite database:', err.message);
    } else {
        console.log('Connected to the SQLite database at:', dbPath);
        initializeDatabase();
    }
});

// Function to initialize the database schema
function initializeDatabase() {
    db.serialize(() => {
        // Create messages table if it doesn't exist
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_username TEXT NOT NULL,
                avatar_id TEXT,
                content_type TEXT NOT NULL CHECK(content_type IN ('text', 'file', 'gif')),
                content_data TEXT NOT NULL, /* For text, this is the message. For file/gif, this is URL or metadata. */
                timestamp TEXT NOT NULL
            )
        `, (err) => {
            if (err) {
                console.error('Error creating messages table:', err.message);
            } else {
                console.log('Messages table initialized or already exists.');
                // Example of adding an index for performance on a frequently queried column
                db.run("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages (timestamp DESC)", (indexErr) => {
                    if (indexErr) {
                        console.error('Error creating index on messages table:', indexErr.message);
                    } else {
                        console.log('Index on messages.timestamp created or already exists.');
                    }
                });
            }
        });

        // Users table (consider if OAuth users should also be stored here or handled differently)
        // For simplicity, this table might store local users, or all users if IDs are managed carefully.
        // The current server.js 'users' array is in-memory; this would be its DB equivalent.
        db.run(`
            CREATE TABLE IF NOT EXISTS users_persistent (
                id TEXT PRIMARY KEY, /* UUID for local, provider ID for OAuth */
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT, /* Null for OAuth users */
                avatar_id TEXT, /* URL or local SVG ID */
                email TEXT,
                github_id TEXT UNIQUE,
                google_id TEXT UNIQUE,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (err) {
                console.error('Error creating users_persistent table:', err.message);
            } else {
                console.log('Users_persistent table initialized or already exists.');
            }
        });
    });
}

// Export the database connection for use in other modules
module.exports = db;
