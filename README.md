# Telegram AI Assistant Bot

A powerful Telegram bot built with Node.js, grammY, and OpenAI API that provides various AI-powered features in groups and private chats with **intelligent reply-based context detection**.

## Features

- 🔍 **Find** - Get quick answers to questions (2-5 sentences)
- 🤖 **Agent** - Detailed step-by-step solutions and suggestions  
- 🌐 **Translate** - Translate text between languages
- 📝 **Summarize** - Summarize long text into key points
- ✨ **Improve** - Enhance text style and grammar
- 💬 **Talk** - Have casual conversations, jokes, and natural chat
- 🧠 **Smart Replies** - Automatic context detection when replying to bot messages

## Setup

1. **Clone or download this project**

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   - Copy `.env.example` to `.env`
   - Add your Telegram Bot Token (get from [@BotFather](https://t.me/BotFather))
   - Add your OpenAI API Key (get from [OpenAI Platform](https://platform.openai.com/))

4. **Start the bot**
   ```bash
   npm start
   ```

   Or for development with auto-restart:
   ```bash
   npm run dev
   ```

## Environment Variables

```bash
BOT_TOKEN=your_telegram_bot_token_here
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini  # Optional: default model
```

## Commands

### /find [text]
Find quick answers to your questions.
```
/find How to install Node.js?
```

### /agent [instruction]
Get detailed step-by-step help and suggestions.
```
/agent Help me prepare for a React job interview
```

### /translate [lang1->lang2] [text]
Translate text between languages.
```
/translate [en->es] Hello, how are you?
/translate [ru->en] Привет, как дела?
```

### /summarize [text]
Summarize long text into key points.
```
/summarize [your long article or text here]
```

### /improve [text]
Improve text style and grammar.
```
/improve i am good developer and want job
```

### /talk [message]
Have casual conversations with the bot, including jokes, greetings, and natural chat.
```
/talk Hello, how are you doing today?
/talk Tell me a joke
/talk What's your favorite programming language?
```

## 🧠 Smart Reply Context Detection

The bot automatically detects the appropriate response style when you **reply to its messages**:

### Automatic Detection Rules:
- **Question-like text** → Responds in `/find` style (concise answers)
- **Task/instruction text** → Responds in `/agent` style (detailed help)  
- **Casual conversation** → Responds in `/talk` style (friendly chat)

### Example Scenarios:

**Scenario 1 (Find Style)**
```
User: /find How to use Node.js with MongoDB?
Bot: You can connect using the official MongoDB driver...

User replies: "Can it also work with Mongoose?" 
→ Bot auto-detects question and responds in find style
```

**Scenario 2 (Agent Style)**  
```
User: /agent Make me a study plan for React
Bot: Day 1: Learn hooks... Day 2: Practice forms...

User replies: "Add some advanced topics too"
→ Bot detects task extension and responds in agent style  
```

**Scenario 3 (Talk Style)**
```
User: /talk Hi bot!
Bot: Hey there 👋 How's your day going?

User replies: "Not so good..."
→ Bot detects casual tone and responds in talk style
```

## Usage Examples

1. **Quick Questions**
   ```
   /find What is React?
   /find How to center a div in CSS?
   ```

2. **Detailed Help**
   ```
   /agent Help me build a REST API with Node.js
   /agent What should I learn to become a full-stack developer?
   ```

3. **Translation**
   ```
   /translate [en->fr] Good morning!
   /translate [es->en] Hola, ¿cómo estás?
   ```

4. **Text Improvement & Casual Chat**
   ```
   /improve can u help me with this code its not working
   /summarize [paste long article here]
   /talk Hey! How's your day going?
   /talk Can you tell me something interesting about AI?
   ```

## Technical Details

- **Framework**: grammY (Telegram Bot Framework)
- **AI Provider**: OpenAI GPT-4o-mini (configurable)
- **Runtime**: Node.js 18+
- **Language**: JavaScript (ES Modules)
- **Smart Context**: Automatic reply detection and context analysis
- **Group Support**: Works in private chats, groups, and supergroups

### Bot Behavior in Different Contexts:
- **Private chats**: Responds to all non-command messages with smart detection
- **Groups**: Only responds when mentioned (@botname) or replying to bot messages
- **Replies**: Maintains context from original message and detects appropriate response style

## Error Handling

The bot includes comprehensive error handling:
- Missing text validation
- API failure recovery  
- User-friendly error messages
- Automatic retries for transient issues

## Development

```bash
# Install dependencies
npm install

# Start in development mode (auto-restart)
npm run dev

# Start in production mode
npm start
```

## License

MIT License - feel free to modify and use for your projects!

---

Created with ❤️ using grammY and OpenAI