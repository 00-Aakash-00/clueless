# Clueless

The invisible desktop AI assistant that provides real-time insights, answers, and support during meetings, interviews, presentations, and professional conversations. Powered by Groq Cloud for ultra-fast inference.

## 🚀 Quick Start Guide

### Prerequisites (All Platforms)

- **Node.js** v18 or higher ([Download](https://nodejs.org/))
- **Git** ([Download](https://git-scm.com/downloads))
- **Groq API Key** (free at [Groq Console](https://console.groq.com/keys))

---

## 🍎 macOS Installation & Setup

### Step 1: Install Prerequisites

```bash
# Install Homebrew (if not installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Node.js
brew install node

# Verify installation
node --version  # Should show v18.x.x or higher
npm --version
```

### Step 2: Clone and Install

```bash
# Clone the repository
git clone https://github.com/00-Aakash-00/clueless.git
cd clueless

# Install dependencies
npm install

# If you encounter Sharp/Python build errors:
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts
npm rebuild sharp
```

### Step 3: Configure Environment

```bash
# Create .env file
touch .env

# Open in your preferred editor and add:
echo "GROQ_API_KEY=your_groq_api_key_here" >> .env
echo "GROQ_TEXT_MODEL=openai/gpt-oss-20b" >> .env
```

Or manually create a `.env` file in the root folder with:
```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_TEXT_MODEL=openai/gpt-oss-20b
```

### Step 4: Run the App

```bash
# Development mode (recommended for first run)
npm start

# Or build for production
npm run dist
# The built .dmg will be in the 'release' folder
```

### macOS Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd + B` | Toggle window visibility (show/hide) |
| `Cmd + H` | Take screenshot for AI analysis |
| `Cmd + K` | Open chat and focus input |
| `Cmd + Enter` | Process screenshots and get solution |
| `Cmd + R` | Reset/Cancel current operation |
| `Cmd + Arrow Keys` | Move window around screen |
| `Cmd + Q` | Quit the application |

### macOS Permissions

On first run, you may need to grant permissions:
1. **Screen Recording**: System Preferences → Privacy & Security → Screen Recording → Enable for Clueless
2. **Accessibility** (optional): System Preferences → Privacy & Security → Accessibility → Enable for Clueless

---

## 🪟 Windows Installation & Setup

### Step 1: Install Prerequisites

**Option A: Using winget (Windows 11 / Windows 10 with winget)**
```powershell
# Open PowerShell as Administrator
winget install OpenJS.NodeJS.LTS
winget install Git.Git

# Restart PowerShell, then verify
node --version  # Should show v18.x.x or higher
npm --version
git --version
```

**Option B: Manual Installation**
1. Download and install Node.js LTS from [nodejs.org](https://nodejs.org/)
2. Download and install Git from [git-scm.com](https://git-scm.com/download/win)
3. Restart your terminal/PowerShell

### Step 2: Clone and Install

```powershell
# Open PowerShell or Command Prompt
git clone https://github.com/00-Aakash-00/clueless.git
cd clueless

# Install dependencies
npm install

# If you encounter build errors, try:
npm install --ignore-scripts
npm rebuild sharp
```

### Step 3: Configure Environment

```powershell
# Create .env file using PowerShell
New-Item -Path ".env" -ItemType File

# Add your API key (replace with your actual key)
Add-Content -Path ".env" -Value "GROQ_API_KEY=your_groq_api_key_here"
Add-Content -Path ".env" -Value "GROQ_TEXT_MODEL=openai/gpt-oss-20b"
```

Or manually create a `.env` file in the root folder with Notepad:
```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_TEXT_MODEL=openai/gpt-oss-20b
```

### Step 4: Run the App

```powershell
# Development mode (recommended for first run)
npm start

# Or build for production
npm run dist
# The built .exe installer will be in the 'release' folder
```

### Windows Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + B` | Toggle window visibility (show/hide) |
| `Ctrl + H` | Take screenshot for AI analysis |
| `Ctrl + K` | Open chat and focus input |
| `Ctrl + Enter` | Process screenshots and get solution |
| `Ctrl + R` | Reset/Cancel current operation |
| `Ctrl + Arrow Keys` | Move window around screen |
| `Ctrl + Q` | Quit the application |

### Windows Firewall

On first run, Windows Firewall may prompt you:
- Click "Allow access" to let the app communicate with Groq's API

---

## 🐧 Linux Installation & Setup

### Step 1: Install Prerequisites

**Ubuntu/Debian:**
```bash
# Update package list
sudo apt update

# Install Node.js (using NodeSource)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs git

# Verify installation
node --version
npm --version
```

**Fedora:**
```bash
sudo dnf install nodejs npm git
```

**Arch Linux:**
```bash
sudo pacman -S nodejs npm git
```

### Step 2: Clone and Install

```bash
git clone https://github.com/00-Aakash-00/clueless.git
cd clueless

# Install dependencies
npm install

# If you encounter Sharp errors:
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts
npm rebuild sharp
```

### Step 3: Configure Environment

```bash
# Create and edit .env file
echo "GROQ_API_KEY=your_groq_api_key_here" > .env
echo "GROQ_TEXT_MODEL=openai/gpt-oss-20b" >> .env
```

### Step 4: Run the App

```bash
npm start
```

### Linux Keyboard Shortcuts

Same as Windows - use `Ctrl` instead of `Cmd`.

---

## 🤖 AI Provider: Groq Cloud

**Features:**
- Ultra-fast inference (fastest available)
- Free tier available with generous limits
- Vision model support (Llama 4 Scout)
- Two text models: GPT-OSS 20B and 120B

**Getting Your API Key:**
1. Go to [Groq Console](https://console.groq.com/keys)
2. Sign up or log in
3. Click "Create API Key"
4. Copy the key and add it to your `.env` file

**Supported Models:**

| Model | Description |
|-------|-------------|
| `openai/gpt-oss-20b` | Fast, efficient text model (default) |
| `openai/gpt-oss-120b` | Larger, more capable text model |
| `meta-llama/llama-4-scout-17b-16e-instruct` | Vision model (auto-used for images) |

---

## 🔧 Troubleshooting

### App Won't Start

**Check if port 5180 is in use:**

*macOS/Linux:*
```bash
lsof -i :5180
kill -9 <PID>  # Replace <PID> with the process ID
```

*Windows:*
```powershell
netstat -ano | findstr :5180
taskkill /PID <PID> /F  # Replace <PID> with the process ID
```

### Sharp/Python Build Errors

```bash
# Clean install
rm -rf node_modules package-lock.json  # macOS/Linux
rmdir /s /q node_modules & del package-lock.json  # Windows

# Reinstall with prebuilt binaries
SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install --ignore-scripts  # macOS/Linux
set SHARP_IGNORE_GLOBAL_LIBVIPS=1 && npm install --ignore-scripts  # Windows

npm rebuild sharp
```

### Window Not Visible

Press `Cmd+B` (macOS) or `Ctrl+B` (Windows) to toggle visibility. The window might be hidden or off-screen.

### API Errors

1. Verify your `GROQ_API_KEY` in `.env` is correct
2. Check you have API credits at [Groq Console](https://console.groq.com/)
3. Ensure you have internet connectivity

### Closing the App

- Press `Cmd+Q` (macOS) or `Ctrl+Q` (Windows/Linux) to quit
- Or use Activity Monitor (macOS) / Task Manager (Windows) to force close

---

## Key Features

### **Invisible AI Assistant**
- Translucent, always-on-top window that's barely noticeable
- Hide/show instantly with global hotkeys
- Content protection enabled (invisible to screen sharing on macOS)

### **Smart Screenshot Analysis**
- Take screenshots of any content with `Cmd/Ctrl + H`
- AI analyzes images, documents, presentations, or problems
- Get instant explanations, answers, and solutions

### **Contextual Chat**
- Chat with AI about anything you see on screen
- Maintains conversation context
- Ask follow-up questions for deeper insights

### **Debug Mode**
- Take additional screenshots after getting a solution
- Press `Cmd/Ctrl + Enter` to debug
- See side-by-side diff of old vs new code

---

## Use Cases

### **Academic & Learning**
- Live presentation support during classes
- Quick research during online exams
- Language translation and explanations
- Math and science problem solving

### **Professional Meetings**
- Sales call preparation and objection handling
- Technical interview coaching
- Client presentation support
- Real-time fact-checking and data lookup

### **Development & Tech**
- Debug error messages instantly
- Code explanation and optimization
- Documentation and API references
- Algorithm and architecture guidance

---

## System Requirements

| | Minimum | Recommended |
|---|---------|-------------|
| **RAM** | 4GB | 8GB+ |
| **CPU** | Dual-core | Quad-core |
| **Storage** | 2GB | 5GB+ |
| **OS** | macOS 10.15+, Windows 10, Ubuntu 20.04+ | Latest versions |

---

## 🤝 Contributing

This project welcomes contributions!

**Ways to contribute:**
- Bug fixes and stability improvements
- New features and AI model integrations
- Documentation and tutorial improvements
- Translations and internationalization
- UI/UX enhancements

---

**Star this repo if Clueless helps you succeed in meetings, interviews, or presentations!**

### Tags

`ai-assistant` `meeting-notes` `interview-helper` `presentation-support` `groq` `groq-cloud` `electron-app` `cross-platform` `open-source` `screenshot-analysis` `academic-helper` `sales-assistant` `coding-companion`
