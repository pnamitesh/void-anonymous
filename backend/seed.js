import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Define Schema (Must match your server.js)
const voidPostSchema = new mongoose.Schema({
  mood: String,
  text: String,
  room: String, // New field for "Rooms"
  authorToken: String,
  status: { type: String, default: "active" },
  replyCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const VoidPost = mongoose.model("VoidPost", voidPostSchema);

const seedData = [
  { mood: "lost", room: "life", text: "I feel like everyone around me is moving forward, getting married, getting promoted, and I'm just frozen in time." },
  { mood: "heartbroken", room: "love", text: "It's been six months and I still check my phone hoping to see your name. I know I shouldn't." },
  { mood: "anxious", room: "work", text: "I have a presentation tomorrow and I feel like I can't breathe. Imposter syndrome is eating me alive." },
  { mood: "numb", room: "general", text: "I don't feel sad, I just feel... nothing. Colors aren't bright anymore." },
  { mood: "angry", room: "family", text: "I try so hard to make my parents proud but it's never enough. I'm tired of running a race I can't win." },
  { mood: "sad", room: "life", text: "I miss my dog. The house is too quiet without the sound of his paws on the floor." },
  { mood: "confused", room: "love", text: "I don't know if I should stay or go. I love him, but I'm not happy." },
  { mood: "anxious", room: "general", text: "The news scares me. I feel like the world is ending and I'm the only one panicking." },
  { mood: "lost", room: "career", text: "I studied for 4 years for this degree and now I hate the job. What do I do now?" },
  { mood: "sad", room: "general", text: "Sometimes I just want a hug, but I don't know who to ask." },
];

async function seedDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("🌱 Connected to DB...");

    // Generate random extra posts to hit 50+ items
    const extras = [];
    for(let i=0; i<30; i++) {
        extras.push({
            mood: ["sad", "lost", "numb"][Math.floor(Math.random()*3)],
            room: ["general", "life"][Math.floor(Math.random()*2)],
            text: `This is anonymous whisper #${i}. I just need someone to listen.`,
            authorToken: "system_seed",
            createdAt: new Date()
        });
    }

    await VoidPost.insertMany([...seedData, ...extras]);
    console.log("✅ Database populated with 40+ whispers.");
    process.exit();
  } catch (err) {
    console.error(err);
  }
}

seedDB();