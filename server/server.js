const express = require('express');
const bcrypt = require('bcrypt');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const db = require('./database.js'); // Require the database module

const app = express();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || 'YOUR_GITHUB_CLIENT_ID';
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || 'YOUR_GITHUB_CLIENT_SECRET';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET';
const port = process.env.PORT || 3000;

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const users = [];
const activeSessions = {};

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'your_very_secret_session_key_change_this_for_production_32_chars_min',
    resave: false,
    saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser(function(user, done) {
    done(null, user.id);
});

passport.deserializeUser(function(id, done) {
    // First, try to find in-memory users (like those from OAuth who haven't been persisted yet or if DB is optional)
    let user = users.find(u => u.id === id);
    if (user) {
        return done(null, user);
    }
    // If not in memory, try to fetch from database (for users persisted from local signup)
    // This part would be more elaborate if fully shifting to DB for all users
    db.get("SELECT * FROM users_persistent WHERE id = ?", [id], (err, row) => {
        if (err) { return done(err); }
        done(null, row || false); // 'false' or null if user not found
    });
});


passport.use(new GitHubStrategy({
    clientID: GITHUB_CLIENT_ID,
    clientSecret: GITHUB_CLIENT_SECRET,
    callbackURL: "http://YOUR_LOCAL_IP:3000/auth/github/callback",
    scope: ['user:email']
},
function(accessToken, refreshToken, profile, done) {
    console.log('GitHub Profile received for ID:', profile.id);
    let user = users.find(u => u.githubId === profile.id);
    if (user) {
        const githubAvatar = (profile.photos && profile.photos[0]) ? profile.photos[0].value : user.avatarId;
        if (user.avatarId !== githubAvatar) {
            user.avatarId = githubAvatar;
            console.log(`Updated avatar for GitHub user ${user.username} to ${user.avatarId}`);
        }
        return done(null, user);
    } else {
        let newUsername = profile.username || profile.displayName;
        if (users.some(u => u.username === newUsername)) {
            newUsername = `${newUsername}-gh-${profile.id.slice(0,4)}`;
        }
        const newUser = {
            id: profile.id,
            username: newUsername,
            githubId: profile.id,
            email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
            avatarId: (profile.photos && profile.photos[0]) ? profile.photos[0].value : 'avatar_01.svg',
            password: null
        };
        users.push(newUser); // Still push to in-memory for now, DB interaction can be added
        console.log(`New user from GitHub: ${newUser.username}`);
        return done(null, newUser);
    }
}
));

passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: "http://YOUR_LOCAL_IP:3000/auth/google/callback",
    scope: ['profile', 'email']
},
function(accessToken, refreshToken, profile, done) {
    console.log('Google Profile received for ID:', profile.id);
    let user = users.find(u => u.googleId === profile.id);
    if (user) {
        const googleAvatar = (profile.photos && profile.photos[0]) ? profile.photos[0].value : user.avatarId;
        if (user.avatarId !== googleAvatar) {
            user.avatarId = googleAvatar;
            console.log(`Updated avatar for Google user ${user.username} to ${user.avatarId}`);
        }
        return done(null, user);
    } else {
        let newUsername = profile.displayName || profile.name.givenName || `user${profile.id.slice(0,5)}`;
        if (users.some(u => u.username === newUsername)) {
            newUsername = `${newUsername}-go-${profile.id.slice(0,4)}`;
        }
        const newUser = {
            id: profile.id,
            username: newUsername,
            googleId: profile.id,
            email: profile.emails && profile.emails[0] ? profile.emails[0].value : null,
            avatarId: profile.photos && profile.photos[0] ? profile.photos[0].value : 'avatar_01.svg',
            password: null
        };
        users.push(newUser); // Still push to in-memory
        console.log(`New user from Google: ${newUser.username}`);
        return done(null, newUser);
    }
}
));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(6).toString('hex');
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.post('/signup', async (req, res) => {
  try {
    const { username, password, avatarId: requestedAvatarId } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Username and password are required.' });

    // Check in-memory users first (includes OAuth users not yet in DB, or if DB is optional)
    if (users.find(user => user.username === username)) return res.status(400).json({ message: 'Username already exists' });
    // TODO: Check users_persistent table in DB as well

    const validLocalAvatarIds = ["avatar_01.svg", "avatar_02.svg", "avatar_03.svg"];
    let avatarId = requestedAvatarId;
    if (typeof avatarId !== 'string' || (!avatarId.startsWith('http') && !validLocalAvatarIds.includes(avatarId))) {
        avatarId = validLocalAvatarIds[0];
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = { id: crypto.randomUUID(), username, password: hashedPassword, avatarId };
    users.push(newUser); // Add to in-memory list
    // TODO: Add user to users_persistent table
    console.log(`User ${username} signed up. Total users: ${users.length}`);
    res.status(201).json({ message: 'User created successfully', username, avatarId });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ message: 'Error creating user' });
  }
});

app.post('/signin', async (req, res) => {
  try {
    const { username, password } = req.body;
    let user = users.find(u => u.username === username);
    // TODO: If not in-memory, try fetching from users_persistent table

    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    if (user.githubId || user.googleId) return res.status(400).json({ message: `Please sign in with ${user.githubId ? 'GitHub' : 'Google'}.` });
    if (!user.password) return res.status(400).json({ message: 'Account error. No password set.'})

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = crypto.randomBytes(16).toString('hex');
    activeSessions[token] = username;
    console.log(`User ${user.username} signed in.`);
    res.status(200).json({ success: true, message: 'Sign-in successful', token, username: user.username, avatarId: user.avatarId });
  } catch (error) {
    console.error('Sign-in error:', error);
    res.status(500).json({ success: false, message: 'Error signing in' });
  }
});

app.get('/auth/github', passport.authenticate('github', { scope: [ 'user:email' ] }));
app.get('/auth/github/callback',
    passport.authenticate('github', { failureRedirect: '/?authError=githubFailure&authProvider=github' }),
    (req, res) => {
        const user = users.find(u => u.id === req.user.id);
        if (user) {
            const token = crypto.randomBytes(16).toString('hex');
            activeSessions[token] = user.username;
            res.redirect(`http://YOUR_LOCAL_IP:8080/?token=${token}&username=${encodeURIComponent(user.username)}&avatarId=${encodeURIComponent(user.avatarId)}&isOAuth=true`);
        } else {
            res.redirect(`http://YOUR_LOCAL_IP:8080/?authError=userNotFound&authProvider=github`);
        }
    }
);

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/?authError=googleFailure&authProvider=google' }),
    (req, res) => {
        const user = users.find(u => u.id === req.user.id);
        if (user) {
            const token = crypto.randomBytes(16).toString('hex');
            activeSessions[token] = user.username;
            res.redirect(`http://YOUR_LOCAL_IP:8080/?token=${token}&username=${encodeURIComponent(user.username)}&avatarId=${encodeURIComponent(user.avatarId)}&isOAuth=true`);
        } else {
            res.redirect(`http://YOUR_LOCAL_IP:8080/?authError=userNotFound&authProvider=google`);
        }
    }
);

function broadcastUserList(wssInstance) {
    const onlineUsers = [];
    wssInstance.clients.forEach(client => {
        if (client.username && client.readyState === WebSocket.OPEN) {
            onlineUsers.push({ username: client.username, avatarId: client.avatarId });
        }
    });
    const message = JSON.stringify({ type: 'user_list_update', users: onlineUsers });
    wssInstance.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            try { client.send(message); } catch (e) { console.error("Error sending user list update:", e); }
        }
    });
}

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  ws.on('message', (messageStr) => {
    const messageString = messageStr.toString();
    if (!ws.username) {
      const token = messageString;
      const username = activeSessions[token];
      if (username) {
        let user = users.find(u => u.username === username);
        // TODO: If not in-memory, try fetching from users_persistent table
        if (!user) {
            ws.send(JSON.stringify({ type: 'auth_fail', message: 'User data error.' }));
            return ws.close();
        }
        ws.username = user.username;
        ws.avatarId = user.avatarId;
        console.log(`User ${ws.username} authenticated WebSocket. Avatar: ${ws.avatarId}`);
        try {
          ws.send(JSON.stringify({ type: 'auth_success', username: ws.username, avatarId: ws.avatarId, message: 'Authenticated.' }));
          broadcastUserList(wss);
        } catch (e) { console.error('Error sending auth_success:', e); }
      } else {
        try { ws.send(JSON.stringify({ type: 'auth_fail', message: 'Invalid token.' })); } catch (e) { console.error("Failed to send auth_fail:", e); }
        ws.close();
      }
      return;
    }

    try {
      const parsedMessage = JSON.parse(messageString);
      let outgoingMessageJSON;
      // let targetClient = null; // This will be determined differently for DMs vs WebRTC signals
      // let broadcastToSender = true; // This logic will change

      const signalingTypes = ['call_request', 'call_accepted', 'call_rejected', 'webrtc_offer', 'webrtc_answer', 'webrtc_ice_candidate', 'call_ended'];

      // --- WebRTC Signaling Handling (largely unchanged but separated for clarity) ---
      if (signalingTypes.includes(parsedMessage.type)) {
        let targetSignalClient = null;
        if (!ws.username) {
            console.log('Unauthenticated client tried to send signaling message.');
            try { ws.send(JSON.stringify({ type: 'auth_fail', message: 'Authentication required for signaling.' })); } catch(eS){ console.error("Error sending auth_fail for signaling:", eS); }
            return ws.close();
        }
        const targetUsername = parsedMessage.targetUsername;
        if (!targetUsername) {
            console.error('Signaling message missing targetUsername:', parsedMessage);
            try { ws.send(JSON.stringify({ type: 'signaling_error', message: 'Target user not specified.'})); } catch(eS){ console.error("Error sending signaling_error (no target):", eS); }
            return;
        }

        if (targetUsername === ws.username) {
            console.warn(`User ${ws.username} attempted to send signaling message to themselves: ${parsedMessage.type}`);
            try { ws.send(JSON.stringify({ type: 'signaling_error', message: 'Cannot send signaling message to yourself.'})); } catch(eS){ console.error("Error sending signaling_error (self signal):", eS); }
            return;
        }

        for (const client of wss.clients) {
            if (client.username === targetUsername && client.readyState === WebSocket.OPEN) {
                targetSignalClient = client;
                break;
            }
        }

        if (targetSignalClient) {
            const messageToForward = {
                type: parsedMessage.type,
                fromUsername: ws.username,
                fromAvatarId: ws.avatarId,
                ...(parsedMessage.offer && { offer: parsedMessage.offer }), // offer is an object itself
                ...(parsedMessage.answer && { answer: parsedMessage.answer }), // answer is an object
                ...(parsedMessage.candidate && { candidate: parsedMessage.candidate }), // candidate is an object
                ...(parsedMessage.reason && { reason: parsedMessage.reason }), // for rejections or hang-ups
                ...(parsedMessage.callType && { callType: parsedMessage.callType }) // 'video' or 'audio' for offers
            };
            try {
                targetSignalClient.send(JSON.stringify(messageToForward));
                console.log(`Relayed ${parsedMessage.type} from ${ws.username} to ${targetUsername}`);
            } catch (e) {
                console.error(`Error relaying ${parsedMessage.type} to ${targetUsername} (targetSignalClient):`, e);
                // Inform sender if relay failed
                try { ws.send(JSON.stringify({ type: 'signaling_error', message: `Failed to deliver message to ${targetUsername}. They might have disconnected.`, target: targetUsername })); } catch(eS){ console.error("Error sending signaling_error (delivery_fail):", eS); }
            }
        } else {
            console.log(`Target user ${targetUsername} not found or not online for signaling message type ${parsedMessage.type}.`);
            try {
                ws.send(JSON.stringify({ type: 'signaling_error', message: `User ${targetUsername} is not available for the call.`, target: targetUsername }));
            } catch (e) { console.error('Error sending signaling_error (target unavailable) back to sender:', e); }
        }
        return; // Signaling messages are handled, return to avoid broadcasting as chat
      }

      // --- Chat, File, GIF, Typing Indicator Handling (Now with DM logic) ---
      const dmTargetUsername = parsedMessage.targetUsername; // Expected for DMs

      if (parsedMessage.type === 'file' && parsedMessage.fileInfo) {
        outgoingMessageJSON = { type: 'file', username: ws.username, avatarId: ws.avatarId, fileInfo: parsedMessage.fileInfo, timestamp: new Date().toISOString(), fromUsername: ws.username };
        if (dmTargetUsername) outgoingMessageJSON.targetUsername = dmTargetUsername; // Add target for DMs
      } else if (parsedMessage.type === 'gif' && parsedMessage.gifInfo && parsedMessage.gifInfo.url) {
        outgoingMessageJSON = { type: 'gif', username: ws.username, avatarId: ws.avatarId, gifInfo: parsedMessage.gifInfo, timestamp: new Date().toISOString(), fromUsername: ws.username };
        if (dmTargetUsername) outgoingMessageJSON.targetUsername = dmTargetUsername;
      } else if (parsedMessage.type === 'typing_start') {
        outgoingMessageJSON = { type: 'user_typing_start', username: ws.username, avatarId: ws.avatarId, fromUsername: ws.username };
        if (dmTargetUsername) outgoingMessageJSON.targetUsername = dmTargetUsername;
      } else if (parsedMessage.type === 'typing_stop') {
        outgoingMessageJSON = { type: 'user_typing_stop', username: ws.username, fromUsername: ws.username };
        if (dmTargetUsername) outgoingMessageJSON.targetUsername = dmTargetUsername;
      } else { // Default to chat message
        const contentToBroadcast = parsedMessage.content || messageString;
        // Ensure content is a string, as JSON.parse might have been attempted on plain text
        const finalContent = typeof contentToBroadcast === 'string' ? contentToBroadcast : JSON.stringify(contentToBroadcast);
        outgoingMessageJSON = { type: 'chat', username: ws.username, avatarId: ws.avatarId, content: finalContent, timestamp: new Date().toISOString(), fromUsername: ws.username };
        if (dmTargetUsername) outgoingMessageJSON.targetUsername = dmTargetUsername;
      }

      if (outgoingMessageJSON) {
        const messageToBroadcastStr = JSON.stringify(outgoingMessageJSON);
        if (dmTargetUsername) { // Private Message / DM
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    // Send to the target user or to the sender (self-confirmation/echo)
                    if (client.username === dmTargetUsername || client === ws) {
                        try { client.send(messageToBroadcastStr); } catch (e) { console.error('Error sending DM:', e); }
                    }
                }
            });
            console.log(`DM from ${ws.username} to ${dmTargetUsername}: ${parsedMessage.type}`);
        } else { // Broadcast to all (Global message - if this logic is to be kept)
            console.warn(`Broadcasting global message type ${outgoingMessageJSON.type} from ${ws.username}. Consider if this is intended.`);
            wss.clients.forEach((client) => {
                if (client.username && client.readyState === WebSocket.OPEN) {
                    // Avoid sending user_typing_start/stop to self if it were global
                    if ((outgoingMessageJSON.type === 'user_typing_start' || outgoingMessageJSON.type === 'user_typing_stop') && client === ws) {
                        // skip
                    } else {
                        try { client.send(messageToBroadcastStr); } catch (e) { console.error('Error broadcasting global message:', e); }
                    }
                }
            });
        }
      }
    } catch (e) { // This catch is for JSON.parse error on the initial messageString
      // If messageString is not JSON, treat it as a plain text chat message (potentially global, or needs target)
      // This behavior might need to be re-evaluated: should plain text always be global? Or require a target?
      // For now, assume plain text without a clear target in JSON is a global message.
      console.warn(`Message from ${ws.username} was not valid JSON: "${messageString}". Treating as potential global chat.`);
      const outgoingChatMessage = JSON.stringify({
          type: 'chat',
          username: ws.username,
          avatarId: ws.avatarId,
          content: messageString, // Send as is
          timestamp: new Date().toISOString(),
          fromUsername: ws.username
        });
      // Broadcast plain text messages globally (excluding sender for echo, though client handles its own display)
      wss.clients.forEach((client) => {
          if (client !== ws && client.username && client.readyState === WebSocket.OPEN) {
              try { client.send(outgoingChatMessage); } catch (err) { console.error('Error sending plain text global chat:', err); }
          }
      });
    }
  });

  ws.on('close', () => {
    if (ws.username) {
      console.log(`Client ${ws.username} disconnected`);
      const typingMsg = JSON.stringify({ type: 'user_typing_stop', username: ws.username });
      wss.clients.forEach(client => {
          if (client !== ws && client.username && client.readyState === WebSocket.OPEN) {
              try { client.send(typingMsg); } catch (e) { console.error('Error sending typing_stop on disconnect:', e); }
          }
      });
    } else {
      console.log('Client disconnected (unauthenticated)');
    }
    broadcastUserList(wss);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${ws.username || 'unauthenticated client'}:`, error);
  });
});

app.post('/upload', upload.single('file'), (req, res) => {
    if (req.file) {
        res.json({
            success: true, message: 'File uploaded successfully',
            filename: req.file.filename, path: req.file.path,
            url: `/files/${req.file.filename}`,
            mimetype: req.file.mimetype, size: req.file.size
        });
    } else {
        res.status(400).json({ success: false, message: 'File upload failed.' });
    }
});

app.get('/files/:filename', (req, res) => {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filePath = path.join(uploadsDir, safeFilename);
    if (!filePath.startsWith(uploadsDir + path.sep)) {
        return res.status(403).send('Forbidden');
    }
    res.sendFile(filePath, (err) => {
        if (err) {
            if (err.code === 'ENOENT') return res.status(404).send('File not found.');
            return res.status(500).send('Error serving file.');
        }
    });
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        console.warn('Multer error:', err);
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'File too large. Max size is 50MB.' });
        }
        return res.status(400).json({ success: false, message: err.message || 'File upload error.' });
    } else if (err) {
        console.error('Unexpected error:', err);
        return res.status(500).json({ success: false, message: 'An unexpected server error.' });
    }
    next();
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Server listening on port ${port}`);
});
