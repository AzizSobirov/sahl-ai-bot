import { Bot, InlineKeyboard, InputFile } from "grammy";
import { config } from "dotenv";
import { OpenAI } from "openai";
import { createServer } from "http";
import https from "https";
import fs from "fs/promises";
import path from "path";

// Load environment variables
config();

// Validate required environment variables
if (!process.env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in .env file");
}

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required in .env file");
}

// Initialize the bot
const bot = new Bot(process.env.BOT_TOKEN);

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Data file path
const DATA_FILE_PATH = path.join(process.cwd(), "data.json");

// Initialize data.json if it doesn't exist
async function initializeDataFile() {
  try {
    await fs.access(DATA_FILE_PATH);
  } catch (error) {
    // File doesn't exist, create it
    const initialData = {
      users: {},
      groups: {},
      bannedUsers: [],
      bannedGroups: [],
      superAdmin: process.env.SUPER_ADMIN,
      statistics: {
        totalAiRequests: 0,
        totalMessages: 0,
        botStarted: new Date().toISOString(),
      },
      settings: {
        antiSpamEnabled: true,
        createdAt: new Date().toISOString(),
        version: "1.0.0",
      },
    };
    await fs.writeFile(DATA_FILE_PATH, JSON.stringify(initialData, null, 2));
    console.log("📄 data.json file created");
  }
}

// Read data from JSON file
async function readData() {
  try {
    const data = await fs.readFile(DATA_FILE_PATH, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading data.json:", error);
    return {
      users: {},
      groups: {},
      bannedUsers: [],
      bannedGroups: [],
      superAdmin: process.env.SUPER_ADMIN,
      statistics: { totalAiRequests: 0, totalMessages: 0 },
      settings: { antiSpamEnabled: true },
    };
  }
}

// Write data to JSON file
async function writeData(data) {
  try {
    await fs.writeFile(DATA_FILE_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Error writing to data.json:", error);
  }
}

// Check if user is super admin
function isSuperAdmin(userId, data) {
  return userId.toString() === data.superAdmin.toString();
}

// Save or update user information
async function saveUserInfo(userId, userInfo, isAiRequest = false) {
  try {
    const data = await readData();

    // Check if user is banned
    if (data.bannedUsers.includes(userId.toString())) {
      return false; // User is banned
    }

    if (!data.users[userId]) {
      data.users[userId] = {
        id: userId,
        firstName: userInfo.first_name || "",
        lastName: userInfo.last_name || "",
        username: userInfo.username || "",
        joinedAt: new Date().toISOString(),
        messageCount: 1,
        lastActivity: new Date().toISOString(),
        isBlocked: false,
        aiRequests: isAiRequest ? 1 : 0,
      };
    } else {
      // Update existing user
      data.users[userId].messageCount += 1;
      data.users[userId].lastActivity = new Date().toISOString();
      if (isAiRequest) data.users[userId].aiRequests += 1;
      if (userInfo.first_name)
        data.users[userId].firstName = userInfo.first_name;
      if (userInfo.last_name) data.users[userId].lastName = userInfo.last_name;
      if (userInfo.username) data.users[userId].username = userInfo.username;
    }

    // Update statistics
    data.statistics.totalMessages += 1;
    if (isAiRequest) data.statistics.totalAiRequests += 1;

    await writeData(data);
    return true; // User is not banned
  } catch (error) {
    console.error("Error saving user info:", error);
    return true; // Allow on error
  }
}

// Save group information
async function saveGroupInfo(groupId, groupInfo) {
  try {
    const data = await readData();

    // Check if group is banned
    if (data.bannedGroups.includes(groupId.toString())) {
      return false; // Group is banned
    }

    if (!data.groups[groupId]) {
      data.groups[groupId] = {
        id: groupId,
        title: groupInfo.title || "",
        type: groupInfo.type || "",
        joinedAt: new Date().toISOString(),
        messageCount: 1,
        lastActivity: new Date().toISOString(),
      };
    } else {
      data.groups[groupId].messageCount += 1;
      data.groups[groupId].lastActivity = new Date().toISOString();
      if (groupInfo.title) data.groups[groupId].title = groupInfo.title;
    }

    await writeData(data);
    return true;
  } catch (error) {
    console.error("Error saving group info:", error);
    return true;
  }
}

// System prompt for the AI assistant
const SYSTEM_PROMPT = `You are an AI assistant working inside a Telegram bot. 
You must handle the following commands:

1. /find [text] → Provide short, clear answers.
2. /agent [instruction] → Act as a smart assistant giving detailed suggestions.
3. /translate [lang1->lang2] [text] → Translate accurately and naturally.
4. /summarize [text] → Summarize the content briefly.
5. /improve [text] → Rewrite text in better style while keeping the meaning.
6. /talk [message] → Have casual conversations, jokes, greetings, and chat naturally.

Rules:
- Always reply in the same language as the command unless translation is requested.
- Keep responses concise and user-friendly.
- Do not add unnecessary disclaimers or instructions.`;

// System prompt specifically for casual conversation
const TALK_SYSTEM_PROMPT = `You are a friendly AI assistant in a Telegram bot. You're having a casual conversation with the user. Be natural, warm, and engaging. You can:

- Make jokes and use humor appropriately
- Ask follow-up questions to keep conversations flowing
- Share interesting facts or thoughts
- Be empathetic and supportive
- Use emojis moderately to add personality
- Respond to greetings warmly
- Engage in small talk naturally

Be conversational but helpful. Keep responses reasonably concise but feel free to be more expressive than in other commands.`;

// Helper function to call OpenAI API
async function callOpenAI(prompt, systemPrompt = SYSTEM_PROMPT) {
  try {
    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      temperature: 0.7,
    });

    return (
      response.choices[0]?.message?.content?.trim() || "No response generated"
    );
  } catch (error) {
    console.error("OpenAI API Error:", error);
    throw new Error("AI service temporarily unavailable");
  }
}

// Helper function to detect response type from user text
function detectResponseType(text) {
  const lowerText = text.toLowerCase().trim();

  // Question indicators for /find behavior
  const questionPatterns = [
    /\b(how|why|what|when|where|which|who)\b/,
    /\?/,
    /\b(explain|define|meaning of|difference between)\b/,
    /\b(is|are|does|do|can|could|would|will)\s+.+\?/,
    /\b(tell me about|show me)\b/,
  ];

  // Instructional/task indicators for /agent behavior
  const agentPatterns = [
    /\b(help me|assist me|guide me)\b/,
    /\b(create|make|build|develop|design)\b/,
    /\b(plan|strategy|steps|process)\b/,
    /\b(suggest|recommend|advise)\b/,
    /\b(solve|fix|improve|optimize)\b/,
    /\b(prepare|organize|structure)\b/,
    /\b(add|include|extend|expand)\b/,
    /\b(teach|learn|study|practice)\b/,
  ];

  // Casual conversation indicators for /talk behavior
  const talkPatterns = [
    /\b(hi|hello|hey|yo|sup|greetings)\b/,
    /\b(good|great|awesome|nice|cool|amazing)\b/,
    /\b(thanks|thank you|thx)\b/,
    /\b(sorry|sad|happy|excited|tired|stressed)\b/,
    /\b(lol|haha|😄|😂|🤣|😊|😢|😭|🙄)\b/,
    /\b(joke|funny|boring|interesting)\b/,
    /\b(not so good|feeling|mood|day going)\b/,
    /\b(bye|goodbye|see you|later|night)\b/,
  ];

  // Check for agent patterns first (more specific)
  for (const pattern of agentPatterns) {
    if (pattern.test(lowerText)) {
      return "agent";
    }
  }

  // Then check for question patterns
  for (const pattern of questionPatterns) {
    if (pattern.test(lowerText)) {
      return "find";
    }
  }

  // Finally check for casual patterns
  for (const pattern of talkPatterns) {
    if (pattern.test(lowerText)) {
      return "talk";
    }
  }

  // Default fallback: if text is short and conversational, treat as talk
  if (lowerText.length < 50 && !lowerText.includes(".")) {
    return "talk";
  }

  // If it has multiple sentences or complex structure, treat as find
  return "find";
}

// Helper function to handle smart responses with context
async function handleSmartResponse(ctx, userText, originalContext = null) {
  const responseType = detectResponseType(userText);

  let systemPrompt;
  let responsePrompt = userText;

  // Add original context if this is a reply
  if (originalContext) {
    responsePrompt = `Previous context: "${originalContext}"\n\nUser's follow-up: ${userText}`;
  }

  switch (responseType) {
    case "find":
      systemPrompt = `You are an AI assistant providing concise, informative answers. Respond in 2-5 sentences with clear, helpful information. Keep it brief but complete.`;
      break;

    case "agent":
      systemPrompt = `You are a smart assistant providing detailed step-by-step solutions, suggestions, and comprehensive help. Be thorough, organized, and provide actionable advice.`;
      break;

    case "talk":
    default:
      systemPrompt = TALK_SYSTEM_PROMPT;
      break;
  }

  try {
    // Check if user is banned before processing AI request
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from,
      true
    );
    if (!userAllowed) {
      return false; // User is banned
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    const response = await callOpenAI(responsePrompt, systemPrompt);

    // Reply to the user's message in groups, direct reply in private chats
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
      });
    } else {
      await ctx.reply(response);
    }

    return true;
  } catch (error) {
    console.error("Error in smart response:", error);
    await ctx.reply("⚠️ Error: Something went wrong, please try again later.");
    return false;
  }
}

// Error handling middleware
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  console.error(err.error);
  ctx.reply("⚠️ Error: Something went wrong, please try again later.");
});

// Admin panel functions
function createMainAdminKeyboard() {
  return new InlineKeyboard()
    .text("📊 Statistics", "admin_stats")
    .text("👥 Users", "admin_users")
    .row()
    .text("🚫 Banned Users", "admin_banned_users")
    .text("🚫 Banned Groups", "admin_banned_groups")
    .row()
    .text("⚙️ Settings", "admin_settings")
    .text("📥 Download Data", "admin_download")
    .row()
    .text("🔄 Refresh", "admin_refresh");
}

function createUserListKeyboard(users, page = 0, itemsPerPage = 5) {
  const keyboard = new InlineKeyboard();
  const startIndex = page * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedUsers = users.slice(startIndex, endIndex);

  paginatedUsers.forEach((user, index) => {
    const userText = `${user.firstName} ${user.lastName || ""} (@${
      user.username || "no_username"
    })`;
    keyboard.text(userText, `user_${user.id}`).row();
  });

  // Navigation buttons
  const navRow = [];
  if (page > 0) {
    navRow.push(keyboard.text("⬅️ Previous", `users_page_${page - 1}`));
  }
  if (endIndex < users.length) {
    navRow.push(keyboard.text("Next ➡️", `users_page_${page + 1}`));
  }
  if (navRow.length > 0) keyboard.row();

  keyboard.text("🔙 Back to Admin", "admin_main");
  return keyboard;
}

function createUserActionKeyboard(userId, isBlocked = false) {
  const keyboard = new InlineKeyboard();

  if (isBlocked) {
    keyboard.text("🔓 Unblock User", `unblock_user_${userId}`);
  } else {
    keyboard.text("🔒 Block User", `block_user_${userId}`);
  }

  keyboard
    .row()
    .text("📊 User Stats", `user_stats_${userId}`)
    .text("🔙 Back to Users", "admin_users");

  return keyboard;
}

// Admin command
bot.command("admin", async (ctx) => {
  try {
    const data = await readData();

    if (!isSuperAdmin(ctx.message.from.id, data)) {
      return ctx.reply("❌ You are not authorized to use this command!");
    }

    const users = Object.values(data.users);
    const totalUsers = users.length;
    const totalAiRequests = data.statistics.totalAiRequests || 0;
    const totalMessages = data.statistics.totalMessages || 0;
    const bannedUsersCount = data.bannedUsers.length;
    const bannedGroupsCount = data.bannedGroups.length;

    // Get active users (last 24 hours)
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeUsers = users.filter(
      (user) => new Date(user.lastActivity) > dayAgo
    ).length;

    const currentTime = new Date().toLocaleTimeString();
    const adminMessage = `🔧 **Super Admin Panel**

📊 **Statistics:**
👥 Total Users: **${totalUsers}**
🤖 Total AI Requests: **${totalAiRequests}**
💬 Total Messages: **${totalMessages}**
🔥 Active Users (24h): **${activeUsers}**

🚫 **Moderation:**
❌ Banned Users: **${bannedUsersCount}**
❌ Banned Groups: **${bannedGroupsCount}**

🤖 Bot Started: ${new Date(data.statistics.botStarted).toLocaleString()}
🔄 Opened at: ${currentTime}`;

    await ctx.reply(adminMessage, {
      reply_markup: createMainAdminKeyboard(),
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Error in admin command:", error);
    ctx.reply("❌ Error loading admin panel.");
  }
});

// Handle admin callback queries
bot.callbackQuery(/^admin_/, async (ctx) => {
  try {
    const data = await readData();

    if (!isSuperAdmin(ctx.callbackQuery.from.id, data)) {
      return ctx.answerCallbackQuery("❌ Unauthorized!");
    }

    const action = ctx.callbackQuery.data;

    switch (action) {
      case "admin_stats":
        const users = Object.values(data.users);
        const groups = Object.values(data.groups);

        const statsMessage = `📊 **Detailed Statistics**

👥 **Users:**
• Total: ${users.length}
• Active (7d): ${
          users.filter(
            (u) =>
              new Date(u.lastActivity) >
              new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          ).length
        }
• Active (30d): ${
          users.filter(
            (u) =>
              new Date(u.lastActivity) >
              new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          ).length
        }

🏘️ **Groups:**
• Total: ${groups.length}
• Active (7d): ${
          groups.filter(
            (g) =>
              new Date(g.lastActivity) >
              new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          ).length
        }

🤖 **AI Usage:**
• Total Requests: ${data.statistics.totalAiRequests}
• Total Messages: ${data.statistics.totalMessages}
• Average per User: ${
          users.length > 0
            ? (data.statistics.totalAiRequests / users.length).toFixed(2)
            : 0
        }`;

        await ctx.editMessageText(statsMessage, {
          reply_markup: new InlineKeyboard().text("🔙 Back", "admin_refresh"),
          parse_mode: "Markdown",
        });
        break;

      case "admin_users":
        const allUsers = Object.values(data.users);
        if (allUsers.length === 0) {
          await ctx.editMessageText("👥 No users found.", {
            reply_markup: new InlineKeyboard().text("🔙 Back", "admin_refresh"),
          });
        } else {
          await ctx.editMessageText(
            `👥 **Users (${allUsers.length} total)**\n\nSelect a user to manage:`,
            {
              reply_markup: createUserListKeyboard(allUsers, 0),
              parse_mode: "Markdown",
            }
          );
        }
        break;

      case "admin_banned_users":
        const bannedUsers = data.bannedUsers.map((id) => {
          const user = data.users[id];
          return user
            ? `${user.firstName} ${user.lastName || ""} (@${
                user.username || id
              })`
            : `ID: ${id}`;
        });

        const bannedMessage =
          bannedUsers.length > 0
            ? `🚫 **Banned Users (${
                bannedUsers.length
              }):**\n\n${bannedUsers.join("\n")}`
            : "✅ No banned users.";

        await ctx.editMessageText(bannedMessage, {
          reply_markup: new InlineKeyboard().text("🔙 Back", "admin_refresh"),
          parse_mode: "Markdown",
        });
        break;

      case "admin_banned_groups":
        const bannedGroups = data.bannedGroups.map((id) => {
          const group = data.groups[id];
          return group ? `${group.title} (${id})` : `ID: ${id}`;
        });

        const bannedGroupsMessage =
          bannedGroups.length > 0
            ? `🚫 **Banned Groups (${
                bannedGroups.length
              }):**\n\n${bannedGroups.join("\n")}`
            : "✅ No banned groups.";

        await ctx.editMessageText(bannedGroupsMessage, {
          reply_markup: new InlineKeyboard().text("🔙 Back", "admin_refresh"),
          parse_mode: "Markdown",
        });
        break;

      case "admin_settings":
        const settingsMessage = `⚙️ **Bot Settings**

🛡️ Anti-Spam: ${data.settings.antiSpamEnabled ? "Enabled" : "Disabled"}
📅 Created: ${new Date(data.settings.createdAt).toLocaleDateString()}
🔢 Version: ${data.settings.version}`;

        await ctx.editMessageText(settingsMessage, {
          reply_markup: new InlineKeyboard()
            .text(
              data.settings.antiSpamEnabled
                ? "🔴 Disable Anti-Spam"
                : "🟢 Enable Anti-Spam",
              "toggle_antispam"
            )
            .row()
            .text("🔙 Back", "admin_refresh"),
          parse_mode: "Markdown",
        });
        break;

      case "admin_download":
        try {
          // Read current data and send as document
          const downloadData = await readData();
          const dataContent = JSON.stringify(downloadData, null, 2);
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const fileName = `bot-data-${timestamp}.json`;
          
          // Create a temporary message to inform user
          await ctx.answerCallbackQuery("📥 Preparing download...");
          
          // Send the data as a document
          await ctx.replyWithDocument(
            new InputFile(Buffer.from(dataContent), fileName),
            {
              caption: `📊 Bot Data Export\n\n📅 Generated: ${new Date().toLocaleString()}\n📦 Size: ${Math.round(Buffer.byteLength(dataContent, 'utf8') / 1024 * 100) / 100} KB`,
              reply_to_message_id: ctx.callbackQuery.message.message_id
            }
          );
          
        } catch (downloadError) {
          console.error("Error downloading data:", downloadError);
          await ctx.answerCallbackQuery("❌ Error generating download!");
        }
        return; // Don't call answerCallbackQuery again

      case "admin_refresh":
      case "admin_main":
        // Refresh main admin panel
        const refreshedData = await readData();
        const refreshUsers = Object.values(refreshedData.users);
        const refreshTotalUsers = refreshUsers.length;
        const refreshTotalAiRequests =
          refreshedData.statistics.totalAiRequests || 0;
        const refreshTotalMessages =
          refreshedData.statistics.totalMessages || 0;
        const refreshBannedUsersCount = refreshedData.bannedUsers.length;
        const refreshBannedGroupsCount = refreshedData.bannedGroups.length;

        const refreshDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const refreshActiveUsers = refreshUsers.filter(
          (user) => new Date(user.lastActivity) > refreshDayAgo
        ).length;

        // Add current time to make message unique
        const currentTime = new Date().toLocaleTimeString();
        const refreshAdminMessage = `🔧 **Super Admin Panel**

📊 **Statistics:**
👥 Total Users: **${refreshTotalUsers}**
🤖 Total AI Requests: **${refreshTotalAiRequests}**
💬 Total Messages: **${refreshTotalMessages}**
🔥 Active Users (24h): **${refreshActiveUsers}**

🚫 **Moderation:**
❌ Banned Users: **${refreshBannedUsersCount}**
❌ Banned Groups: **${refreshBannedGroupsCount}**

🤖 Bot Started: ${new Date(refreshedData.statistics.botStarted).toLocaleString()}
🔄 Last Refresh: ${currentTime}`;

        try {
          await ctx.editMessageText(refreshAdminMessage, {
            reply_markup: createMainAdminKeyboard(),
            parse_mode: "Markdown",
          });
        } catch (editError) {
          // If edit fails due to same content, just answer callback
          console.log("Message content unchanged, skipping edit");
        }
        break;
    }

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error("Error in admin callback:", error);
    ctx.answerCallbackQuery("❌ Error occurred!");
  }
});

// Handle user pagination
bot.callbackQuery(/^users_page_(\d+)$/, async (ctx) => {
  try {
    const data = await readData();

    if (!isSuperAdmin(ctx.callbackQuery.from.id, data)) {
      return ctx.answerCallbackQuery("❌ Unauthorized!");
    }

    const page = parseInt(ctx.match[1]);
    const allUsers = Object.values(data.users);

    await ctx.editMessageText(
      `👥 **Users (${allUsers.length} total)**\n\nSelect a user to manage:`,
      {
        reply_markup: createUserListKeyboard(allUsers, page),
        parse_mode: "Markdown",
      }
    );

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error("Error in user pagination:", error);
    ctx.answerCallbackQuery("❌ Error occurred!");
  }
});

// Handle user actions
bot.callbackQuery(/^user_(\d+)$/, async (ctx) => {
  try {
    const data = await readData();

    if (!isSuperAdmin(ctx.callbackQuery.from.id, data)) {
      return ctx.answerCallbackQuery("❌ Unauthorized!");
    }

    const userId = ctx.match[1];
    const user = data.users[userId];

    if (!user) {
      return ctx.answerCallbackQuery("❌ User not found!");
    }

    const isBlocked = data.bannedUsers.includes(userId);

    const userMessage = `👤 **User Details**

📝 Name: ${user.firstName} ${user.lastName || ""}
👤 Username: @${user.username || "no_username"}
🆔 ID: ${user.id}
📅 Joined: ${new Date(user.joinedAt).toLocaleDateString()}
💬 Messages: ${user.messageCount}
🤖 AI Requests: ${user.aiRequests || 0}
📱 Last Activity: ${new Date(user.lastActivity).toLocaleString()}
🚫 Status: ${isBlocked ? "❌ Blocked" : "✅ Active"}`;

    await ctx.editMessageText(userMessage, {
      reply_markup: createUserActionKeyboard(userId, isBlocked),
      parse_mode: "Markdown",
    });

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error("Error showing user details:", error);
    ctx.answerCallbackQuery("❌ Error occurred!");
  }
});

// Handle block/unblock user
bot.callbackQuery(/^(block|unblock)_user_(\d+)$/, async (ctx) => {
  try {
    const data = await readData();

    if (!isSuperAdmin(ctx.callbackQuery.from.id, data)) {
      return ctx.answerCallbackQuery("❌ Unauthorized!");
    }

    const action = ctx.match[1];
    const userId = ctx.match[2];
    const user = data.users[userId];

    if (!user) {
      return ctx.answerCallbackQuery("❌ User not found!");
    }

    if (action === "block") {
      if (!data.bannedUsers.includes(userId)) {
        data.bannedUsers.push(userId);
        data.users[userId].isBlocked = true;
        await writeData(data);
        await ctx.answerCallbackQuery(
          `✅ User ${user.firstName} blocked successfully!`
        );
      } else {
        await ctx.answerCallbackQuery("⚠️ User is already blocked!");
      }
    } else {
      const index = data.bannedUsers.indexOf(userId);
      if (index > -1) {
        data.bannedUsers.splice(index, 1);
        data.users[userId].isBlocked = false;
        await writeData(data);
        await ctx.answerCallbackQuery(
          `✅ User ${user.firstName} unblocked successfully!`
        );
      } else {
        await ctx.answerCallbackQuery("⚠️ User is not blocked!");
      }
    }

    // Refresh the user details
    const isBlocked = data.bannedUsers.includes(userId);

    const userMessage = `👤 **User Details**

📝 Name: ${user.firstName} ${user.lastName || ""}
👤 Username: @${user.username || "no_username"}
🆔 ID: ${user.id}
📅 Joined: ${new Date(user.joinedAt).toLocaleDateString()}
💬 Messages: ${user.messageCount}
🤖 AI Requests: ${user.aiRequests || 0}
📱 Last Activity: ${new Date(user.lastActivity).toLocaleString()}
🚫 Status: ${isBlocked ? "❌ Blocked" : "✅ Active"}`;

    await ctx.editMessageText(userMessage, {
      reply_markup: createUserActionKeyboard(userId, isBlocked),
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Error blocking/unblocking user:", error);
    ctx.answerCallbackQuery("❌ Error occurred!");
  }
});

// Handle toggle anti-spam
bot.callbackQuery("toggle_antispam", async (ctx) => {
  try {
    const data = await readData();

    if (!isSuperAdmin(ctx.callbackQuery.from.id, data)) {
      return ctx.answerCallbackQuery("❌ Unauthorized!");
    }

    data.settings.antiSpamEnabled = !data.settings.antiSpamEnabled;
    await writeData(data);

    const settingsMessage = `⚙️ **Bot Settings**

🛡️ Anti-Spam: ${data.settings.antiSpamEnabled ? "Enabled" : "Disabled"}
📅 Created: ${new Date(data.settings.createdAt).toLocaleDateString()}
🔢 Version: ${data.settings.version}`;

    await ctx.editMessageText(settingsMessage, {
      reply_markup: new InlineKeyboard()
        .text(
          data.settings.antiSpamEnabled
            ? "🔴 Disable Anti-Spam"
            : "🟢 Enable Anti-Spam",
          "toggle_antispam"
        )
        .row()
        .text("🔙 Back", "admin_refresh"),
      parse_mode: "Markdown",
    });

    await ctx.answerCallbackQuery(
      `Anti-spam ${data.settings.antiSpamEnabled ? "enabled" : "disabled"}!`
    );
  } catch (error) {
    console.error("Error toggling anti-spam:", error);
    ctx.answerCallbackQuery("❌ Error occurred!");
  }
});

// Start command
bot.command("start", async (ctx) => {
  // Save user information when they start the bot
  const userAllowed = await saveUserInfo(ctx.message.from.id, ctx.message.from);
  if (!userAllowed) {
    return ctx.reply("❌ You are banned from using this bot.");
  }

  // Save group info if in group
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    const groupAllowed = await saveGroupInfo(ctx.chat.id, ctx.chat);
    if (!groupAllowed) {
      return; // Group is banned
    }
  }

  const welcomeMessage = `🤖 Welcome to AI Assistant Bot!

Available commands:
/find [text] - Find answers to your questions
/agent [instruction] - Get detailed step-by-step help
/translate [lang1->lang2] [text] - Translate between languages
/summarize [text] - Summarize long text
/improve [text] - Improve your text style
/talk [message] - Have a casual chat with me

Just type any command followed by your text!`;

  ctx.reply(welcomeMessage);
});

// Help command
bot.command("help", (ctx) => {
  const helpMessage = `🆘 Available Commands:

🔍 /find [text]
Find quick answers to your questions (2-5 sentences)

🤖 /agent [instruction] 
Get detailed step-by-step solutions and suggestions

🌐 /translate [lang1->lang2] [text]
Translate text between languages (e.g., en->es, ru->en)

📝 /summarize [text]
Summarize long text into key points

✨ /improve [text]
Improve grammar, clarity and style of your text

💬 /talk [message]
Have casual conversations, jokes, and natural chat

Examples:
• /find How to install Node.js?
• /agent Help me prepare for a job interview
• /translate [en->es] Hello, how are you?
• /summarize [your long text here]
• /improve i am good developer and want job
• /talk Hello, how are you doing today?`;

  ctx.reply(helpMessage);
});

// /find command - Find answers to questions (concise 2-5 sentences)
bot.command("find", async (ctx) => {
  const text = ctx.match;

  if (!text || text.trim().length === 0) {
    return ctx.reply(
      "❗ Please provide text after the command.\n\nExample: /find How to install Node.js?"
    );
  }

  try {
    // Check if user is banned before processing AI request
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from,
      true
    );
    if (!userAllowed) {
      return ctx.reply("❌ You are banned from using this bot.");
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    const findPrompt = `Please provide a concise answer (2-5 sentences maximum) to this question: ${text}`;
    const response = await callOpenAI(findPrompt);

    // Reply to the user's message in groups, direct reply in private chats
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
      });
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error("Error in /find command:", error);
    await ctx.reply("⚠️ Error: Something went wrong, please try again later.");
  }
});

// /agent command - Act as smart assistant with detailed solutions
bot.command("agent", async (ctx) => {
  const text = ctx.match;

  if (!text || text.trim().length === 0) {
    return ctx.reply(
      "❗ Please provide text after the command.\n\nExample: /agent Help me prepare for a React job interview"
    );
  }

  try {
    // Check if user is banned before processing AI request
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from,
      true
    );
    if (!userAllowed) {
      return ctx.reply("❌ You are banned from using this bot.");
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    const agentPrompt = `Act as a smart assistant and provide detailed step-by-step solutions, brainstorming ideas, or comprehensive instructions for this request: ${text}
        
        Please provide alternatives, improvements, or suggestions where appropriate. Be thorough but organized.`;

    const response = await callOpenAI(agentPrompt);

    // Reply to the user's message in groups, direct reply in private chats
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
      });
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error("Error in /agent command:", error);
    await ctx.reply("⚠️ Error: Something went wrong, please try again later.");
  }
});

// /translate command - Translate text between languages
bot.command("translate", async (ctx) => {
  const text = ctx.match;

  if (!text || text.trim().length === 0) {
    return ctx.reply(
      "❗ Please provide text after the command.\n\nExample: /translate [en->es] Hello, how are you?"
    );
  }

  try {
    // Check if user is banned before processing AI request
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from,
      true
    );
    if (!userAllowed) {
      return ctx.reply("❌ You are banned from using this bot.");
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    // Parse the translation request
    const langRegex = /^\[([a-z]{2})->([a-z]{2})\]\s*(.+)$/i;
    const match = text.match(langRegex);

    let translatePrompt;
    if (match) {
      const [, sourceLang, targetLang, textToTranslate] = match;
      translatePrompt = `Translate the following text from ${sourceLang} to ${targetLang}. Provide only the translation, nothing else: ${textToTranslate}`;
    } else {
      // If no language specification, try to detect and ask for clarification
      translatePrompt = `Please translate this text to English (or if it's already in English, translate to Spanish). If you're unsure about the source language, please detect it first: ${text}`;
    }

    const response = await callOpenAI(translatePrompt);

    // Reply to the user's message in groups, direct reply in private chats
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
      });
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error("Error in /translate command:", error);
    await ctx.reply("⚠️ Error: Something went wrong, please try again later.");
  }
});

// /summarize command - Summarize long text into key points
bot.command("summarize", async (ctx) => {
  const text = ctx.match;

  if (!text || text.trim().length === 0) {
    return ctx.reply(
      "❗ Please provide text after the command.\n\nExample: /summarize [your long text here]"
    );
  }

  try {
    // Check if user is banned before processing AI request
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from,
      true
    );
    if (!userAllowed) {
      return ctx.reply("❌ You are banned from using this bot.");
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    const summarizePrompt = `Please summarize the following text in 2-4 sentences maximum. Focus on the key points and main ideas: ${text}`;
    const response = await callOpenAI(summarizePrompt);

    // Reply to the user's message in groups, direct reply in private chats
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
      });
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error("Error in /summarize command:", error);
    await ctx.reply("⚠️ Error: Something went wrong, please try again later.");
  }
});

// /improve command - Improve text style and grammar
bot.command("improve", async (ctx) => {
  const text = ctx.match;

  if (!text || text.trim().length === 0) {
    return ctx.reply(
      "❗ Please provide text after the command.\n\nExample: /improve i am good developer and want job"
    );
  }

  try {
    // Check if user is banned before processing AI request
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from,
      true
    );
    if (!userAllowed) {
      return ctx.reply("❌ You are banned from using this bot.");
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    const improvePrompt = `Please improve the following text by fixing grammar, enhancing clarity, and making it more professional while keeping the original meaning: ${text}`;
    const response = await callOpenAI(improvePrompt);

    // Reply to the user's message in groups, direct reply in private chats
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
      });
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error("Error in /improve command:", error);
    await ctx.reply("⚠️ Error: Something went wrong, please try again later.");
  }
});

// /talk command - Have casual conversations with the bot
bot.command("talk", async (ctx) => {
  const text = ctx.match;

  if (!text || text.trim().length === 0) {
    return ctx.reply(
      "❗ Please provide a message after the command.\n\nExample: /talk Hello, how are you?"
    );
  }

  try {
    // Check if user is banned before processing AI request
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from,
      true
    );
    if (!userAllowed) {
      return ctx.reply("❌ You are banned from using this bot.");
    }

    // Show typing indicator
    await ctx.replyWithChatAction("typing");

    const response = await callOpenAI(text, TALK_SYSTEM_PROMPT);

    // Reply to the user's message in groups, direct reply in private chats
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
      await ctx.reply(response, {
        reply_to_message_id: ctx.message.message_id,
      });
    } else {
      await ctx.reply(response);
    }
  } catch (error) {
    console.error("Error in /talk command:", error);
    await ctx.reply("⚠️ Error: Something went wrong, please try again later.");
  }
});

// Handle unknown commands or regular messages with smart reply detection
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;

  // Save user information for all messages (except bot messages)
  if (ctx.message.from && !ctx.message.from.is_bot) {
    const userAllowed = await saveUserInfo(
      ctx.message.from.id,
      ctx.message.from
    );
    if (!userAllowed) {
      return; // User is banned, don't process message
    }
  }

  // Save group info if in group
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    const groupAllowed = await saveGroupInfo(ctx.chat.id, ctx.chat);
    if (!groupAllowed) {
      return; // Group is banned
    }
  }

  // Skip if it's a command that was already handled
  if (text.startsWith("/")) {
    return ctx.reply(
      "❓ Unknown command. Type /help to see available commands."
    );
  }

  // Check if this is a reply to a bot message
  if (ctx.message.reply_to_message) {
    const repliedMessage = ctx.message.reply_to_message;

    // Check if the replied message is from our bot
    if (
      repliedMessage.from &&
      repliedMessage.from.is_bot &&
      repliedMessage.from.username === ctx.me.username
    ) {
      // Extract context from the original bot message
      const originalContext = repliedMessage.text;

      // Use smart response system with context
      await handleSmartResponse(ctx, text, originalContext);
      return;
    }
  }

  // For non-reply, non-command messages in private chats, use smart response
  if (ctx.chat.type === "private") {
    await handleSmartResponse(ctx, text);
  } else {
    // In groups, only respond if bot is mentioned or it's clearly directed at the bot
    const botUsername = ctx.me.username;
    const mentionedBot =
      text.includes(`@${botUsername}`) ||
      text.toLowerCase().includes("bot") ||
      text.toLowerCase().includes(ctx.me.first_name.toLowerCase());

    if (mentionedBot) {
      // Remove bot mention from text for processing
      const cleanText = text
        .replace(`@${botUsername}`, "")
        .replace(/\bbot\b/gi, "")
        .trim();
      await handleSmartResponse(ctx, cleanText || text);
    }
  }
});

// Graceful shutdown handling
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down bot gracefully...");

  // Clear keep-alive interval
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    console.log("🔄 Keep-alive mechanism stopped");
  }

  bot.stop();
  server.close(() => {
    console.log("🌐 HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down bot gracefully...");

  // Clear keep-alive interval
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    console.log("🔄 Keep-alive mechanism stopped");
  }

  bot.stop();
  server.close(() => {
    console.log("🌐 HTTP server closed");
    process.exit(0);
  });
});

// Create HTTP server for health checks and keep-alive
const server = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        bot: "Telegram AI Assistant",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      })
    );
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

// Get port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;

// Keep-alive interval reference for cleanup
let keepAliveInterval;

// Keep-alive function to prevent Render.com from sleeping
function keepAlive() {
  const url =
    process.env.RENDER_EXTERNAL_URL || `https://sahl-ai-bot.onrender.com`;

  console.log(`🏓 Pinging ${url}/health to stay awake...`);

  https
    .get(`${url}/health`, (res) => {
      if (res.statusCode === 200) {
        console.log("✅ Keep-alive ping successful");
      } else {
        console.log(`⚠️ Keep-alive ping returned status: ${res.statusCode}`);
      }
    })
    .on("error", (err) => {
      console.log("❌ Keep-alive ping failed:", err.message);
    });
}

// Start the HTTP server
server.listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
  console.log(`🩺 Health check available at http://localhost:${PORT}/health`);

  // Set up keep-alive pinging every 10 minutes (only in production)
  if (
    process.env.NODE_ENV === "production" ||
    process.env.RENDER_EXTERNAL_URL
  ) {
    console.log("🔄 Setting up keep-alive mechanism for Render.com...");
    keepAliveInterval = setInterval(keepAlive, 10 * 60 * 1000); // Ping every 10 minutes

    // Initial ping after 1 minute
    setTimeout(keepAlive, 60 * 1000);
  }
});

// Initialize data file and start the bot
async function startBot() {
  await initializeDataFile();

  console.log("🤖 Starting Telegram AI Assistant Bot...");
  console.log(`📱 Model: ${OPENAI_MODEL}`);
  console.log("🛡️ Anti-spam protection enabled");
  console.log("👤 User tracking and admin panel enabled");
  console.log("📊 Statistics tracking enabled");

  bot.start();
  console.log("✅ Bot is running! Press Ctrl+C to stop.");
}

startBot().catch(console.error);
