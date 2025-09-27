import { Bot } from 'grammy';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import { createServer } from 'http';

// Load environment variables
config();

// Validate required environment variables
if (!process.env.BOT_TOKEN) {
    throw new Error('BOT_TOKEN is required in .env file');
}

if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required in .env file');
}

// Initialize the bot
const bot = new Bot(process.env.BOT_TOKEN);

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

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
                { role: 'system', content: systemPrompt },
                { role: 'user', content: prompt }
            ],
            max_tokens: 1000,
            temperature: 0.7,
        });

        return response.choices[0]?.message?.content?.trim() || 'No response generated';
    } catch (error) {
        console.error('OpenAI API Error:', error);
        throw new Error('AI service temporarily unavailable');
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
        /\b(tell me about|show me)\b/
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
        /\b(teach|learn|study|practice)\b/
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
        /\b(bye|goodbye|see you|later|night)\b/
    ];
    
    // Check for agent patterns first (more specific)
    for (const pattern of agentPatterns) {
        if (pattern.test(lowerText)) {
            return 'agent';
        }
    }
    
    // Then check for question patterns
    for (const pattern of questionPatterns) {
        if (pattern.test(lowerText)) {
            return 'find';
        }
    }
    
    // Finally check for casual patterns
    for (const pattern of talkPatterns) {
        if (pattern.test(lowerText)) {
            return 'talk';
        }
    }
    
    // Default fallback: if text is short and conversational, treat as talk
    if (lowerText.length < 50 && !lowerText.includes('.')) {
        return 'talk';
    }
    
    // If it has multiple sentences or complex structure, treat as find
    return 'find';
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
        case 'find':
            systemPrompt = `You are an AI assistant providing concise, informative answers. Respond in 2-5 sentences with clear, helpful information. Keep it brief but complete.`;
            break;
            
        case 'agent':
            systemPrompt = `You are a smart assistant providing detailed step-by-step solutions, suggestions, and comprehensive help. Be thorough, organized, and provide actionable advice.`;
            break;
            
        case 'talk':
        default:
            systemPrompt = TALK_SYSTEM_PROMPT;
            break;
    }
    
    try {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        const response = await callOpenAI(responsePrompt, systemPrompt);
        
        // Reply to the user's message in groups, direct reply in private chats
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            await ctx.reply(response, {
                reply_to_message_id: ctx.message.message_id
            });
        } else {
            await ctx.reply(response);
        }
        
        return true;
    } catch (error) {
        console.error('Error in smart response:', error);
        await ctx.reply('⚠️ Error: Something went wrong, please try again later.');
        return false;
    }
}

// Error handling middleware
bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    console.error(err.error);
    ctx.reply('⚠️ Error: Something went wrong, please try again later.');
});

// Start command
bot.command('start', (ctx) => {
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
bot.command('help', (ctx) => {
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
bot.command('find', async (ctx) => {
    const text = ctx.match;
    
    if (!text || text.trim().length === 0) {
        return ctx.reply('❗ Please provide text after the command.\n\nExample: /find How to install Node.js?');
    }

    try {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        const findPrompt = `Please provide a concise answer (2-5 sentences maximum) to this question: ${text}`;
        const response = await callOpenAI(findPrompt);
        
        // Reply to the user's message in groups, direct reply in private chats
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            await ctx.reply(response, {
                reply_to_message_id: ctx.message.message_id
            });
        } else {
            await ctx.reply(response);
        }
    } catch (error) {
        console.error('Error in /find command:', error);
        await ctx.reply('⚠️ Error: Something went wrong, please try again later.');
    }
});

// /agent command - Act as smart assistant with detailed solutions
bot.command('agent', async (ctx) => {
    const text = ctx.match;
    
    if (!text || text.trim().length === 0) {
        return ctx.reply('❗ Please provide text after the command.\n\nExample: /agent Help me prepare for a React job interview');
    }

    try {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        const agentPrompt = `Act as a smart assistant and provide detailed step-by-step solutions, brainstorming ideas, or comprehensive instructions for this request: ${text}
        
        Please provide alternatives, improvements, or suggestions where appropriate. Be thorough but organized.`;
        
        const response = await callOpenAI(agentPrompt);
        
        // Reply to the user's message in groups, direct reply in private chats
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            await ctx.reply(response, {
                reply_to_message_id: ctx.message.message_id
            });
        } else {
            await ctx.reply(response);
        }
    } catch (error) {
        console.error('Error in /agent command:', error);
        await ctx.reply('⚠️ Error: Something went wrong, please try again later.');
    }
});

// /translate command - Translate text between languages
bot.command('translate', async (ctx) => {
    const text = ctx.match;
    
    if (!text || text.trim().length === 0) {
        return ctx.reply('❗ Please provide text after the command.\n\nExample: /translate [en->es] Hello, how are you?');
    }

    try {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
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
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            await ctx.reply(response, {
                reply_to_message_id: ctx.message.message_id
            });
        } else {
            await ctx.reply(response);
        }
    } catch (error) {
        console.error('Error in /translate command:', error);
        await ctx.reply('⚠️ Error: Something went wrong, please try again later.');
    }
});

// /summarize command - Summarize long text into key points
bot.command('summarize', async (ctx) => {
    const text = ctx.match;
    
    if (!text || text.trim().length === 0) {
        return ctx.reply('❗ Please provide text after the command.\n\nExample: /summarize [your long text here]');
    }

    try {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        const summarizePrompt = `Please summarize the following text in 2-4 sentences maximum. Focus on the key points and main ideas: ${text}`;
        const response = await callOpenAI(summarizePrompt);
        
        // Reply to the user's message in groups, direct reply in private chats
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            await ctx.reply(response, {
                reply_to_message_id: ctx.message.message_id
            });
        } else {
            await ctx.reply(response);
        }
    } catch (error) {
        console.error('Error in /summarize command:', error);
        await ctx.reply('⚠️ Error: Something went wrong, please try again later.');
    }
});

// /improve command - Improve text style and grammar
bot.command('improve', async (ctx) => {
    const text = ctx.match;
    
    if (!text || text.trim().length === 0) {
        return ctx.reply('❗ Please provide text after the command.\n\nExample: /improve i am good developer and want job');
    }

    try {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        const improvePrompt = `Please improve the following text by fixing grammar, enhancing clarity, and making it more professional while keeping the original meaning: ${text}`;
        const response = await callOpenAI(improvePrompt);
        
        // Reply to the user's message in groups, direct reply in private chats
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            await ctx.reply(response, {
                reply_to_message_id: ctx.message.message_id
            });
        } else {
            await ctx.reply(response);
        }
    } catch (error) {
        console.error('Error in /improve command:', error);
        await ctx.reply('⚠️ Error: Something went wrong, please try again later.');
    }
});

// /talk command - Have casual conversations with the bot
bot.command('talk', async (ctx) => {
    const text = ctx.match;
    
    if (!text || text.trim().length === 0) {
        return ctx.reply('❗ Please provide a message after the command.\n\nExample: /talk Hello, how are you?');
    }

    try {
        // Show typing indicator
        await ctx.replyWithChatAction('typing');
        
        const response = await callOpenAI(text, TALK_SYSTEM_PROMPT);
        
        // Reply to the user's message in groups, direct reply in private chats
        if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
            await ctx.reply(response, {
                reply_to_message_id: ctx.message.message_id
            });
        } else {
            await ctx.reply(response);
        }
    } catch (error) {
        console.error('Error in /talk command:', error);
        await ctx.reply('⚠️ Error: Something went wrong, please try again later.');
    }
});

// Handle unknown commands or regular messages with smart reply detection
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    
    // Skip if it's a command that was already handled
    if (text.startsWith('/')) {
        return ctx.reply('❓ Unknown command. Type /help to see available commands.');
    }
    
    // Check if this is a reply to a bot message
    if (ctx.message.reply_to_message) {
        const repliedMessage = ctx.message.reply_to_message;
        
        // Check if the replied message is from our bot
        if (repliedMessage.from && repliedMessage.from.is_bot && repliedMessage.from.username === ctx.me.username) {
            // Extract context from the original bot message
            const originalContext = repliedMessage.text;
            
            // Use smart response system with context
            await handleSmartResponse(ctx, text, originalContext);
            return;
        }
    }
    
    // For non-reply, non-command messages in private chats, use smart response
    if (ctx.chat.type === 'private') {
        await handleSmartResponse(ctx, text);
    } else {
        // In groups, only respond if bot is mentioned or it's clearly directed at the bot
        const botUsername = ctx.me.username;
        const mentionedBot = text.includes(`@${botUsername}`) || 
                            text.toLowerCase().includes('bot') ||
                            text.toLowerCase().includes(ctx.me.first_name.toLowerCase());
        
        if (mentionedBot) {
            // Remove bot mention from text for processing
            const cleanText = text.replace(`@${botUsername}`, '').replace(/\bbot\b/gi, '').trim();
            await handleSmartResponse(ctx, cleanText || text);
        }
    }
});

// Graceful shutdown handling
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down bot gracefully...');
    bot.stop();
    server.close(() => {
        console.log('🌐 HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down bot gracefully...');
    bot.stop();
    server.close(() => {
        console.log('🌐 HTTP server closed');
        process.exit(0);
    });
});

// Create HTTP server for health checks and webhooks
const server = createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            bot: 'Telegram AI Assistant',
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }));
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

// Get port from environment variable or default to 3000
const PORT = process.env.PORT || 3000;

// Start the HTTP server
server.listen(PORT, () => {
    console.log(`🌐 HTTP server listening on port ${PORT}`);
    console.log(`🩺 Health check available at http://localhost:${PORT}/health`);
});

// Start the bot
console.log('🤖 Starting Telegram AI Assistant Bot...');
console.log(`📱 Model: ${OPENAI_MODEL}`);
bot.start();
console.log('✅ Bot is running! Press Ctrl+C to stop.');