# Minecraft AFK Bot (Mineflayer)

Lightweight Minecraft AFK bot built with Node.js and mineflayer.

This project was made as a educational usage, not a bypass
or exploit.

Attention This Program is "as is" so that means if anything happens to your account even if it is (Server ban, Stolen information, etc.) i am not responsable for any harm and this program has no "secret code" to do any backdoor

---

## Features

- Automatic reconnect
- Anti-AFK
- Auto-eat
- Interactive CLI command system

---

## Requirements

- Node.js 18+
- Minecraft Java Edition account (offline or Microsoft)
- A server that allows bot connections

---

## Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/YOUR_USERNAME/minecraft-afk-bot.git
cd minecraft-afk-bot
npm install

--

## Usage

- node bot.js <host> [port] <username/email> [offline|microsoft]
- For program side commands you should use "/" followed by the command.
- For server side commands you use "//" followed by the command
- CLI Commands
```bash help        Show available commands
 status      Show bot health, food, and connection state
 jump on     Enable anti-AFK jumping
 jump off    Disable anti-AFK jumping
 reconnect   Force reconnect
 disconnect  Disconnect from server
 clear       Clear the console
 exit        Cleanly exit the bot
