import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors({
  allowedHeaders: ['Content-Type', 'x-void-key']
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("✨ VOID Database Connected"))
  .catch((err) => console.error("❌ DB Error:", err));

// ==================
// SCHEMAS
// ==================

// 1. User (Device Fingerprint)
const userSchema = new mongoose.Schema({
  deviceToken: { type: String, required: true, unique: true },
  lightPoints: { type: Number, default: 0 },
  isBanned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

// 2. Post
const voidPostSchema = new mongoose.Schema({
  mood: String,
  text: String,
  // NEW: Room categorization
  room: { type: String, default: "general", index: true }, 
  authorToken: String,
  status: { type: String, default: "active" }, // active, hidden, deleted
  reports: { type: Number, default: 0 },
  replyCount: { type: Number, default: 0 }, // Used for load balancing
  createdAt: { type: Date, default: Date.now },
});

// Index for fast random lookups & sorting by unreplied posts
voidPostSchema.index({ status: 1, room: 1, replyCount: 1 });

// 3. Reply
const voidReplySchema = new mongoose.Schema({
  postId: { type: mongoose.Schema.Types.ObjectId, ref: "VoidPost" },
  text: String,
  responderToken: String,
  isAuthorReply: { type: Boolean, default: false },
  status: { type: String, default: "visible" },
  reports: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const VoidPost = mongoose.model("VoidPost", voidPostSchema);
const VoidReply = mongoose.model("VoidReply", voidReplySchema);



// ==================
// NEW MIDDLEWARE & UTILS
// ==================

// We no longer track IPs. We trust the Key.
// async function authUser(req, res, next) {
//   // 1. Get the key from the request header
//   const voidKey = req.headers["x-void-key"];

//   if (!voidKey || voidKey.length < 10) {
//     return res.status(401).json({ error: "Missing or invalid Void Key" });
//   }

//   // 2. Find the user by their UNIQUE Key
//   let user = await User.findOne({ deviceToken: voidKey });

//   // 3. If they don't exist, create them (The first time they use a generated key)
//   if (!user) {
//     user = await User.create({ deviceToken: voidKey });
//     console.log(`🌑 New Void Traveler: ${voidKey.substring(0, 6)}...`);
//   }

//   if (user.isBanned) {
//     return res.status(200).json({ success: true, shadowBanned: true });
//   }

//   req.user = user;
//   next();
// }

async function authUser(req, res, next) {
  // 1. Get the key from the request header
  const voidKey = req.headers["x-void-key"];

  if (!voidKey) {
    return res.status(401).json({ error: "Missing Void Key" });
  }

  // --- SECURITY FIX: Enforce Key Format ---
  // Must look like: VOID-XXXX-XXXX-XXXX (uppercase alphanumeric)
  const keyPattern = /^VOID-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  
  if (!keyPattern.test(voidKey)) {
     return res.status(401).json({ error: "Invalid Key Format. Access Denied." });
  }
  // ----------------------------------------

  // 2. Find the user by their UNIQUE Key
  let user = await User.findOne({ deviceToken: voidKey });

  // 3. If they don't exist, create them
  if (!user) {
    user = await User.create({ deviceToken: voidKey });
    console.log(`🌑 New Void Traveler: ${voidKey.substring(0, 6)}...`);
  }

  if (user.isBanned) {
    return res.status(200).json({ success: true, shadowBanned: true });
  }

  req.user = user;
  next();
}


function moderateText(text) {
  const prohibited = ["suicide", "kill myself", "die", "murder", "hate you"];
  return !prohibited.some(word => text.toLowerCase().includes(word));
}

// ==================
// PUBLIC ROUTES
// ==================

// Get My Profile (Points)
app.get("/api/me", authUser, (req, res) => {
  res.json({ lightPoints: req.user.lightPoints });
});

// Create Post
app.post("/api/post", authUser, async (req, res) => {
  const { mood, text, room } = req.body;
  
  if (!mood || !text) return res.status(400).json({ error: "Empty fields" });
  if (!moderateText(text)) return res.status(400).json({ error: "Harmful content detected" });

  // Sanitize room input (Default to 'general' if invalid)
  const validRooms = ['general', 'love', 'work', 'family', 'life'];
  const assignedRoom = validRooms.includes(room) ? room : 'general';

  const post = await VoidPost.create({
    mood, 
    text, 
    room: assignedRoom,
    authorToken: req.user.deviceToken
  });
  
  // Reward: 1 Point for releasing pain
  await User.findOneAndUpdate({ deviceToken: req.user.deviceToken }, { $inc: { lightPoints: 1 } });

  res.status(201).json(post);
});

// Get Random Post (Smart Matching)
// app.get("/api/post/random", authUser, async (req, res) => {
//   const { room } = req.query;

//   // 1. Build Filter
//   let matchStage = { 
//     status: "active", 
//     reports: { $lt: 3 },
//     authorToken: { $ne: req.user.deviceToken } // Don't show my own posts
//   };

//   // Filter by specific room if requested (and not 'all')
//   if (room && room !== 'all') {
//     matchStage.room = room;
//   }

//   // 2. Aggregation Pipeline
//   const posts = await VoidPost.aggregate([
//     { $match: matchStage },
//     // Randomize sort order slightly so 50 users don't all get the exact same post
//     { $addFields: { sortKey: { $rand: {} } } }, 
//     // PRIORITIZE posts with 0 replies (replyCount: 1 ascending), then random
//     { $sort: { replyCount: 1, sortKey: 1 } }, 
//     { $limit: 1 }
//   ]);
  
//   if (!posts.length) return res.status(204).send();
//   res.json(posts[0]);
// });
// Get Random Post (Improved Algorithm: Fresh & Lonely)
app.get("/api/post/random", authUser, async (req, res) => {
  const { room } = req.query;

  // 1. Build Filter
  let matchStage = { 
    status: "active", 
    reports: { $lt: 3 },
    authorToken: { $ne: req.user.deviceToken } // Don't show my own posts
  };

  if (room && room !== 'all') {
    matchStage.room = room;
  }

  // 2. Aggregation Pipeline
  const posts = await VoidPost.aggregate([
    { $match: matchStage },
    
    // --- THE ALGORITHM FIX ---
    
    // Step A: Sort by lowest replies first (Help the lonely), 
    // BUT break ties by newest creation date (Help the urgent).
    { $sort: { replyCount: 1, createdAt: -1 } },

    // Step B: Grab the top 50 candidates. 
    // This gives us a pool of the "Freshest & Loneliest" posts.
    { $limit: 50 },

    // Step C: Pick 1 random post from that pool.
    // This adds variety so every user doesn't get the exact same "top" post.
    { $sample: { size: 1 } }
  ]);
  
  if (!posts.length) return res.status(204).send();
  
  // (Optional) Add a flag so frontend knows if it's a "fresh" signal
  const post = posts[0];
  res.json(post);
});

// Create Reply
app.post("/api/reply", authUser, async (req, res) => {
  const { postId, text } = req.body;
  if (!postId || !text) return res.status(400).json({ error: "Missing data" });

  const post = await VoidPost.findById(postId);
  if (!post) return res.status(404).json({ error: "Not found" });

  const isAuthor = post.authorToken === req.user.deviceToken;

  await VoidReply.create({
    postId, text, 
    responderToken: req.user.deviceToken,
    isAuthorReply: isAuthor
  });

  // Increment reply count so this post shows up less frequently in random fetch
  await VoidPost.findByIdAndUpdate(postId, { $inc: { replyCount: 1 } });

  // Reward: 5 Points for replying
  await User.findOneAndUpdate({ deviceToken: req.user.deviceToken }, { $inc: { lightPoints: 5 } });

  res.json({ success: true });
});

// Report Content
app.post("/api/report", authUser, async (req, res) => {
  const { type, id } = req.body; // type: 'post' or 'reply'
  
  if (type === 'post') {
    const p = await VoidPost.findByIdAndUpdate(id, { $inc: { reports: 1 } }, { new: true });
    if (p.reports >= 3) await VoidPost.findByIdAndUpdate(id, { status: "hidden" });
  } else {
    const r = await VoidReply.findByIdAndUpdate(id, { $inc: { reports: 1 } }, { new: true });
    if (r.reports >= 3) await VoidReply.findByIdAndUpdate(id, { status: "hidden" });
  }
  
  res.json({ success: true, message: "Reported." });
});

// Get My Room Data
// app.get("/api/my-room", authUser, async (req, res) => {
//   const token = req.user.deviceToken;
  
//   // 1. Posts I made
//   const myPosts = await VoidPost.find({ authorToken: token }).sort({ createdAt: -1 }).lean();
//   const postsWithReplies = await Promise.all(myPosts.map(async p => {
//     const replies = await VoidReply.find({ postId: p._id, status: "visible" });
//     return { ...p, replies };
//   }));

//   // 2. Posts I replied to
//   const myReplies = await VoidReply.find({ responderToken: token, isAuthorReply: false }).lean();
//   const interactions = await Promise.all(myReplies.map(async r => {
//     const post = await VoidPost.findById(r.postId);
//     if (!post) return null;
//     const allReplies = await VoidReply.find({ postId: post._id, status: "visible" });
//     return { post, allReplies };
//   }));

//   res.json({ myPosts: postsWithReplies, myInteractions: interactions.filter(i => i) });
// });

// Get My Room Data (Fixed Duplication)
app.get("/api/my-room", authUser, async (req, res) => {
  const token = req.user.deviceToken;
  
  // 1. Posts I made (My Whispers)
  const myPosts = await VoidPost.find({ authorToken: token }).sort({ createdAt: -1 }).lean();
  const postsWithReplies = await Promise.all(myPosts.map(async p => {
    const replies = await VoidReply.find({ postId: p._id, status: "visible" });
    return { ...p, replies };
  }));

  // 2. Posts I replied to (Joined Whispers) - FIXED
  // distinct('postId') gets the list of unique Post IDs I have replied to, preventing duplicates.
  const myInteractedPostIds = await VoidReply.find({ responderToken: token, isAuthorReply: false }).distinct('postId');
  
  const interactions = await Promise.all(myInteractedPostIds.map(async pid => {
    const post = await VoidPost.findById(pid);
    if (!post) return null;
    const allReplies = await VoidReply.find({ postId: pid, status: "visible" });
    return { post, allReplies };
  }));

  res.json({ myPosts: postsWithReplies, myInteractions: interactions.filter(i => i) });
});



// ==================
// ADMIN ROUTES
// ==================
const ADMIN_KEY = process.env.ADMIN_KEY || "secret123";

app.get("/api/admin/dashboard", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Forbidden" });
  
  const flaggedPosts = await VoidPost.find({ reports: { $gt: 0 } }).sort({ reports: -1 });
  const flaggedReplies = await VoidReply.find({ reports: { $gt: 0 } }).sort({ reports: -1 });
  
  res.json({ flaggedPosts, flaggedReplies });
});

app.delete("/api/admin/ban", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: "Forbidden" });
  
  const { token, deleteContent } = req.body;
  await User.findOneAndUpdate({ deviceToken: token }, { isBanned: true });
  
  if (deleteContent) {
    await VoidPost.updateMany({ authorToken: token }, { status: "deleted" });
    await VoidReply.updateMany({ responderToken: token }, { status: "deleted" });
  }
  
  res.json({ success: true, message: "User banished." });
});

// Serve Frontend
app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "../frontend/index.html")));

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(`🌑 VOID Online: http://localhost:${PORT}`));


// Export the Express API for Vercel Serverless
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🌑 VOID Online: http://localhost:${PORT}`));
}

export default app;

