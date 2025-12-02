# Cluely

[Cluely](https://cluely.com) - The invisible desktop assistant that provides real-time insights, answers, and support during meetings, interviews, presentations, and professional conversations.

## 🚀 Quick Start Guide

### Prerequisites

- Make sure you have Node.js installed on your computer
- Git installed on your computer
- A Groq API key (get it from [Groq Console](https://console.groq.com/keys))

### Installation Steps

1. Clone the repository:

```bash
git clone [repository-url]
cd free-cluely
```

2. Install dependencies:

```bash
# If you encounter Sharp/Python build errors, use this:
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts
npm rebuild sharp

# Or for normal installation:
npm install
```

3. Set up environment variables:

   - Create a file named `.env` in the root folder

   ```env
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_TEXT_MODEL=openai/gpt-oss-20b
   ```

   - Available text models:
     - `openai/gpt-oss-20b` (default, faster)
     - `openai/gpt-oss-120b` (larger, more capable)

   - Save the file

### Running the App

#### Method 1: Development Mode (Recommended for first run)

1. Start the development server:

```bash
npm start
```

This command automatically:

- Starts the Vite dev server on port 5180
- Waits for the server to be ready
- Launches the Electron app

#### Method 2: Production Build

```bash
npm run dist
```

The built app will be in the `release` folder.

## 🤖 AI Provider: Groq Cloud

**Features:**

- Ultra-fast inference (fastest available)
- Free tier available with generous limits
- Vision model support (Llama 4 Scout)
- Two text models: GPT-OSS 20B and 120B

**Setup:**

1. Get API key from [Groq Console](https://console.groq.com/keys)
2. Add to `.env` file as `GROQ_API_KEY=your_key_here`
3. Optionally set `GROQ_TEXT_MODEL` to choose between models

**Supported Models:**

| Model | Description |
|-------|-------------|
| `openai/gpt-oss-20b` | Fast, efficient text model (default) |
| `openai/gpt-oss-120b` | Larger, more capable text model |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Vision model (auto-used for images) |

### ⚠️ Important Notes

1. **Closing the App**:

   - Press `Cmd + Q` (Mac) or `Ctrl + Q` (Windows/Linux) to quit
   - Or use Activity Monitor/Task Manager to close `Interview Coder`
   - The X button currently doesn't work (known issue)

2. **If the app doesn't start**:

   - Make sure no other app is using port 5180
   - Try killing existing processes:
     ```bash
     # Find processes using port 5180
     lsof -i :5180
     # Kill them (replace [PID] with the process ID)
     kill [PID]
     ```
   - Verify your Groq API key is correct

3. **Keyboard Shortcuts**:
   - `Cmd/Ctrl + B`: Toggle window visibility
   - `Cmd/Ctrl + H`: Take screenshot
   - `Cmd/Enter`: Get solution
   - `Cmd/Ctrl + Arrow Keys`: Move window

## 🔧 Troubleshooting

### Windows Issues Fixed

- **UI not loading**: Port mismatch resolved
- **Electron crashes**: Improved error handling
- **Build failures**: Production config updated
- **Window focus problems**: Platform-specific fixes applied

### Ubuntu/Linux Issues Fixed

- **Window interaction**: Fixed focusable settings
- **Installation confusion**: Clear setup instructions
- **Missing dependencies**: All requirements documented

### Common Solutions

#### Sharp/Python Build Errors

If you see `gyp ERR! find Python` or Sharp build errors:

```bash
# Solution 1: Use prebuilt binaries
rm -rf node_modules package-lock.json
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts
npm rebuild sharp

# Solution 2: Or install Python (if you prefer building from source)
brew install python3  # macOS
# Then run: npm install
```

#### General Installation Issues

If you see other errors:

1. Delete the `node_modules` folder
2. Delete `package-lock.json`
3. Run `npm install` again
4. Try running with `npm start`

### Platform-Specific Notes

- **Windows**: App now works on Windows 10/11
- **Ubuntu/Linux**: Tested on Ubuntu 20.04+ and most Linux distros
- **macOS**: Native support with proper window management

## Key Features

### **Invisible AI Assistant**

- Translucent, always-on-top window that's barely noticeable
- Hide/show instantly with global hotkeys
- Works seamlessly across all applications

### **Smart Screenshot Analysis**

- Take screenshots of any content with `Cmd/Ctrl + H`
- AI analyzes images, documents, presentations, or problems
- Get instant explanations, answers, and solutions

### **Contextual Chat**

- Chat with AI about anything you see on screen
- Maintains conversation context
- Ask follow-up questions for deeper insights

### **Cross-Platform Support**

- **Windows 10/11** - Full support with native performance
- **Ubuntu/Linux** - Optimized for all major distributions
- **macOS** - Native window management and shortcuts

## Use Cases

### **Academic & Learning**

```
✓ Live presentation support during classes
✓ Quick research during online exams
✓ Language translation and explanations
✓ Math and science problem solving
```

### **Professional Meetings**

```
✓ Sales call preparation and objection handling
✓ Technical interview coaching
✓ Client presentation support
✓ Real-time fact-checking and data lookup
```

### **Development & Tech**

```
✓ Debug error messages instantly
✓ Code explanation and optimization
✓ Documentation and API references
✓ Algorithm and architecture guidance
```

## Why Choose Free Cluely?

| Feature           | Free Cluely        | Commercial Alternatives |
| ----------------- | ------------------ | ----------------------- |
| **Cost**          | 100% Free          | $29-99/month            |
| **Speed**         | Ultra-fast (Groq)  | Variable                |
| **Open Source**   | Full transparency  | Closed source           |
| **Customization** | Fully customizable | Limited options         |
| **Data Control**  | You own your data  | Third-party servers     |

## Technical Details

### **AI Models Supported (via Groq Cloud)**

- **openai/gpt-oss-20b** - Fast, efficient text model
- **openai/gpt-oss-120b** - Larger, more capable text model
- **meta-llama/llama-4-scout-17b-16e-instruct** - Vision model for image analysis

### **System Requirements**

```bash
Minimum:  4GB RAM, Dual-core CPU, 2GB storage
Recommended: 8GB+ RAM, Quad-core CPU, 5GB+ storage
```

## 🤝 Contributing

This project welcomes contributions! While I have limited time for active maintenance, I'll review and merge quality PRs.

**Ways to contribute:**

- 🐛 Bug fixes and stability improvements
- ✨ New features and AI model integrations
- 📚 Documentation and tutorial improvements
- 🌍 Translations and internationalization
- 🎨 UI/UX enhancements

---

**⭐ Star this repo if Free Cluely helps you succeed in meetings, interviews, or presentations!**

### 🏷️ Tags

`ai-assistant` `meeting-notes` `interview-helper` `presentation-support` `groq` `groq-cloud` `electron-app` `cross-platform` `open-source` `screenshot-analysis` `academic-helper` `sales-assistant` `coding-companion`
