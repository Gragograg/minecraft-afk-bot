/**
 * Minecraft AFK Bot - CLI Tool
 * Keep your Minecraft character online with anti-AFK measures
 */

const mineflayer = require("mineflayer");
const readline = require("readline");

// Suppress noisy protocol warnings
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stdout.write = (chunk, encoding, callback) => {
    const str = chunk.toString();
    if (str.includes("partial packet") || str.includes("Chunk size")) {
        if (callback) callback();
        return true;
    }
    return originalStdoutWrite(chunk, encoding, callback);
};

process.stderr.write = (chunk, encoding, callback) => {
    const str = chunk.toString();
    if (str.includes("partial packet") || str.includes("Chunk size")) {
        if (callback) callback();
        return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
};

// Configuration
const config = {
    host: process.argv[2],
    port: Number(process.argv[3]) || 25565,
    username: process.argv[4],
    auth: process.argv[5] || "offline",
    autoReconnect: true,
    reconnectDelay: 10000,
    jumpInterval: 1000,
    autoEat: {
        enabled: true,
        startAt: 14,
        bannedFood: []
    }
};

if (!config.host || !config.username) {
    console.log("Usage: node bot.js <host> [port] <username/email> [offline|microsoft]");
    console.log("\nExamples:");
    console.log("  node bot.js donutsmp.net 25565 your@email.com microsoft");
    console.log("  node bot.js localhost 25565 BotName offline");
    process.exit(1);
}

// State
let bot = null;
let jumpInterval = null;
let shouldReconnect = true;
let isReconnecting = false;
let isEating = false;
let isExiting = false;
let startTime = null;

let stats = {
    messagesReceived: 0,
    messagesSent: 0,
    deaths: 0,
    reconnects: 0,
    foodEaten: 0
};

// Setup readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
});

// Command definitions
const commands = {
    help: {
        desc: "Show all available commands",
        usage: "help [command]",
        run: (args) => {
            if (args.length > 0) {
                const cmd = commands[args[0]];
                if (cmd) {
                    console.log("\n" + args[0] + " - " + cmd.desc);
                    console.log("Usage: " + cmd.usage);
                    if (cmd.aliases) {
                        console.log("Aliases: " + cmd.aliases.join(", "));
                    }
                } else {
                    console.log("[Command] Unknown command: " + args[0]);
                }
            } else {
                console.log("\n=== Available Commands ===");
                Object.keys(commands).forEach(name => {
                    const cmd = commands[name];
                    console.log("  " + name.padEnd(15) + " - " + cmd.desc);
                });
                console.log("\nType '/help <command>' for more info");
                console.log("Type '//command' to send commands to the server");
                console.log("Type anything else to send as chat\n");
            }
        }
    },

    status: {
        desc: "Show bot status and statistics",
        usage: "status",
        aliases: ["s", "info"],
        run: () => {
            if (!bot) {
                console.log("[Status] Not connected");
                return;
            }

            console.log("\n=== Bot Status ===");
            console.log("Username: " + (bot.username || "Unknown"));
            console.log("Health: " + (bot.health || 0) + "/20");
            console.log("Food: " + (bot.food || 0) + "/20");

            if (bot.entity && bot.entity.position) {
                const pos = bot.entity.position;
                console.log("Position: " + Math.floor(pos.x) + ", " + Math.floor(pos.y) + ", " + Math.floor(pos.z));
            }

            if (startTime) {
                const uptime = Math.floor((Date.now() - startTime) / 1000);
                console.log("Uptime: " + formatTime(uptime));
            }

            console.log("\n=== Statistics ===");
            console.log("Messages received: " + stats.messagesReceived);
            console.log("Messages sent: " + stats.messagesSent);
            console.log("Deaths: " + stats.deaths);
            console.log("Reconnects: " + stats.reconnects);
            console.log("Food eaten: " + stats.foodEaten);
            console.log("");
        }
    },

    jump: {
        desc: "Make the bot jump once",
        usage: "jump",
        aliases: ["j"],
        run: () => {
            if (!bot) {
                console.log("[Command] Not connected");
                return;
            }

            try {
                bot.setControlState("jump", true);
                setTimeout(() => bot.setControlState("jump", false), 300);
                console.log("[Command] Jumped");
            } catch (e) {
                console.log("[Command] Failed: " + e.message);
            }
        }
    },

    toggle: {
        desc: "Toggle features on/off",
        usage: "toggle <afk|eat|reconnect>",
        aliases: ["t"],
        run: (args) => {
            if (args.length === 0) {
                console.log("[Toggle] Usage: toggle <afk|eat|reconnect>");
                console.log("Current settings:");
                console.log("  Anti-AFK: " + (jumpInterval ? "ON" : "OFF"));
                console.log("  Auto-eat: " + (config.autoEat.enabled ? "ON" : "OFF"));
                console.log("  Auto-reconnect: " + (config.autoReconnect ? "ON" : "OFF"));
                return;
            }

            const feature = args[0].toLowerCase();

            if (feature === "afk") {
                if (jumpInterval) {
                    stopJumping();
                    console.log("[Toggle] Anti-AFK disabled");
                } else {
                    startJumping();
                    console.log("[Toggle] Anti-AFK enabled");
                }
            } else if (feature === "eat") {
                config.autoEat.enabled = !config.autoEat.enabled;
                console.log("[Toggle] Auto-eat " + (config.autoEat.enabled ? "enabled" : "disabled"));
            } else if (feature === "reconnect") {
                config.autoReconnect = !config.autoReconnect;
                console.log("[Toggle] Auto-reconnect " + (config.autoReconnect ? "enabled" : "disabled"));
            } else {
                console.log("[Toggle] Unknown feature: " + feature);
                console.log("Available: afk, eat, reconnect");
            }
        }
    },

    interval: {
        desc: "Change jump interval",
        usage: "interval <milliseconds>",
        run: (args) => {
            if (args.length === 0) {
                console.log("[Interval] Current: " + config.jumpInterval + "ms");
                return;
            }

            const newInterval = parseInt(args[0]);
            if (isNaN(newInterval) || newInterval < 100) {
                console.log("[Interval] Must be >= 100ms");
                return;
            }

            config.jumpInterval = newInterval;
            console.log("[Interval] Set to " + newInterval + "ms");

            if (jumpInterval) {
                stopJumping();
                startJumping();
                console.log("[Interval] Restarted with new timing");
            }
        }
    },

    disconnect: {
        desc: "Disconnect from server",
        usage: "disconnect",
        aliases: ["dc"],
        run: () => {
            if (!bot) {
                console.log("[Disconnect] Not connected");
                return;
            }

            shouldReconnect = false;
            console.log("[Disconnect] Disconnecting...");

            try {
                bot.quit();
            } catch (e) {
                console.log("[Disconnect] Error: " + e.message);
            }
        }
    },

    reconnect: {
        desc: "Reconnect to server",
        usage: "reconnect",
        aliases: ["rc"],
        run: () => {
            if (bot) {
                console.log("[Reconnect] Disconnecting first...");
                try {
                    bot.quit();
                } catch (e) {}
            }

            shouldReconnect = true;
            console.log("[Reconnect] Connecting...");
            setTimeout(() => createBot(), 1000);
        }
    },

    clear: {
        desc: "Clear the console",
        usage: "clear",
        aliases: ["cls"],
        run: () => {
            console.clear();
            showWelcome();
        }
    },

    exit: {
        desc: "Exit the bot",
        usage: "exit",
        run: () => {
            console.log("\n[Exit] Shutting down...");
            isExiting = true;
            shouldReconnect = false;
            stopJumping();

            try {
                if (bot && bot.quit) bot.quit();
            } catch (e) {}

            rl.close();
            setTimeout(() => process.exit(0), 500);
        }
    }
};

// Handle user input
rl.on("line", (line) => {
    const trimmed = line.trim();

    if (!trimmed) {
        rl.prompt();
        return;
    }

    // Handle bot commands (/)
    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
        const parts = trimmed.slice(1).split(" ");
        const cmdName = parts[0].toLowerCase();
        const args = parts.slice(1);

        // Find command by name or alias
        let command = commands[cmdName];
        if (!command) {
            for (const [name, cmd] of Object.entries(commands)) {
                if (cmd.aliases && cmd.aliases.includes(cmdName)) {
                    command = cmd;
                    break;
                }
            }
        }

        if (command) {
            command.run(args);
        } else {
            console.log("[Command] Unknown: " + cmdName);
            console.log("Type '/help' for available commands");
        }
    }
    // Handle server commands (//)
    else if (trimmed.startsWith("//")) {
        const serverCmd = trimmed.slice(1); // Remove one slash, keep the other
        if (!bot) {
            console.log("[Chat] Not connected");
        } else {
            try {
                bot.chat(serverCmd);
                stats.messagesSent++;
            } catch (e) {
                console.log("[Chat] Error: " + e.message);
            }
        }
    }
    // Send as regular chat
    else {
        if (!bot) {
            console.log("[Chat] Not connected");
        } else {
            try {
                bot.chat(trimmed);
                stats.messagesSent++;
            } catch (e) {
                console.log("[Chat] Error: " + e.message);
            }
        }
    }

    rl.prompt();
});

// Utility functions
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    let result = "";
    if (hours > 0) result += hours + "h ";
    if (minutes > 0) result += minutes + "m ";
    result += secs + "s";
    return result;
}

function showWelcome() {
    console.log("=".repeat(60));
    console.log("           Minecraft AFK Bot - CLI Tool");
    console.log("=".repeat(60));
    console.log("Server: " + config.host + ":" + config.port);
    console.log("Username: " + config.username);
    console.log("Auth: " + config.auth);
    console.log("\nType '/help' for commands");
    console.log("Type '//command' to send server commands");
    console.log("Type anything else to chat");
    console.log("=".repeat(60) + "\n");
}

// Bot creation
function createBot() {
    bot = mineflayer.createBot({
        host: config.host,
        port: config.port,
        username: config.username,
        auth: config.auth,
        version: false,
        hideErrors: false,
    });

    setupBotEvents();
}

// Anti-AFK jumping
function startJumping() {
    if (jumpInterval) clearInterval(jumpInterval);

    console.log("[Anti-AFK] Jumping enabled (every " + (config.jumpInterval / 1000) + "s)");

    jumpInterval = setInterval(() => {
        if (!bot || !bot.entity) return;

        try {
            bot.setControlState("jump", true);
            setTimeout(() => {
                if (bot && bot.setControlState) {
                    bot.setControlState("jump", false);
                }
            }, 300);
        } catch (e) {
            // Silent fail
        }
    }, config.jumpInterval);
}

function stopJumping() {
    if (jumpInterval) {
        clearInterval(jumpInterval);
        jumpInterval = null;
        console.log("[Anti-AFK] Jumping stopped");
    }
}

// Auto-eat system
async function tryEat() {
    if (!config.autoEat.enabled || isEating || !bot) return;
    if (bot.food >= config.autoEat.startAt) return;

    try {
        isEating = true;

        const items = bot.inventory.items();
        if (items.length === 0) {
            console.log("[AutoEat] No items in inventory (Food: " + bot.food + "/20)");
            isEating = false;
            return;
        }

        // Find edible food
        const foods = items.filter(item => {
            if (!item || !item.name) return false;
            if (config.autoEat.bannedFood.includes(item.name)) return false;

            try {
                return bot.registry.foodsByName[item.name] !== undefined;
            } catch (e) {
                // Fallback list of common food items
                const commonFood = [
                    'apple', 'bread', 'cooked_beef', 'cooked_chicken', 'cooked_cod',
                    'cooked_mutton', 'cooked_porkchop', 'cooked_rabbit', 'cooked_salmon',
                    'cookie', 'golden_apple', 'enchanted_golden_apple', 'golden_carrot',
                    'melon_slice', 'mushroom_stew', 'beetroot_soup', 'rabbit_stew',
                    'baked_potato', 'beef', 'carrot', 'chicken', 'cod', 'mutton',
                    'porkchop', 'potato', 'rabbit', 'salmon', 'dried_kelp', 'sweet_berries'
                ];
                return commonFood.some(f => item.name.includes(f));
            }
        });

        if (foods.length === 0) {
            console.log("[AutoEat] No food found (Food: " + bot.food + "/20)");
            isEating = false;
            return;
        }

        const food = foods[0];
        console.log("[AutoEat] Eating " + food.name + " (Food: " + bot.food + "/20)");

        await bot.equip(food, "hand");
        await bot.consume();

        stats.foodEaten++;
        console.log("[AutoEat] Done eating (Food: " + bot.food + "/20)");

    } catch (err) {
        console.log("[AutoEat] Error: " + err.message);
    } finally {
        isEating = false;
    }
}

// Bot event handlers
function setupBotEvents() {
    bot.on("login", () => {
        console.log("[Login] Logged in as " + bot.username);
        startTime = Date.now();
        if (!isExiting) rl.prompt();
    });

        bot.on("spawn", () => {
            console.log("[Spawn] Spawned in world");

            if (bot.entity && bot.entity.position) {
                console.log("[Spawn] Position: " + bot.entity.position);
            }

            startJumping();
            if (!isExiting) rl.prompt();
        });

            bot.on("chat", (username, message) => {
                if (username === bot.username) return;
                console.log("<" + username + "> " + message);
                stats.messagesReceived++;
                if (!isExiting) rl.prompt();
            });

                bot.on("whisper", (username, message) => {
                    console.log("[Whisper] <" + username + "> " + message);
                    stats.messagesReceived++;
                    if (!isExiting) rl.prompt();
                });

                    bot.on("kicked", (reason) => {
                        let reasonStr = reason;
                        try {
                            if (typeof reason === 'object') {
                                reasonStr = JSON.stringify(reason);
                            }
                        } catch (e) {
                            reasonStr = String(reason);
                        }

                        console.log("[Kicked] " + reasonStr);
                        stopJumping();

                        try {
                            if (bot && bot.quit) {
                                bot.quit();
                                bot = null;
                            }
                        } catch (e) {}

                        attemptReconnect("kicked");
                        if (!isExiting) rl.prompt();
                    });

                        bot.on("error", (err) => {
                            console.log("[Error] " + err.message);
                            if (!isExiting) rl.prompt();
                        });

                            bot.on("end", (reason) => {
                                console.log("[Disconnected] " + (reason || "Connection ended"));
                                stopJumping();
                                bot = null;

                                if (reason !== "socketClosed") {
                                    attemptReconnect("disconnected");
                                }
                                if (!isExiting) rl.prompt();
                            });

                                bot.on("death", () => {
                                    console.log("[Death] Died, respawning...");
                                    stats.deaths++;
                                    try {
                                        bot.respawn();
                                    } catch (e) {
                                        console.log("[Death] Respawn failed: " + e.message);
                                    }
                                    if (!isExiting) rl.prompt();
                                });

                                    bot.on("health", () => {
                                        if (bot.health < 10) {
                                            console.log("[Health] Low health: " + bot.health.toFixed(1) + "/20");
                                            if (!isExiting) rl.prompt();
                                        }

                                        if (bot.food < config.autoEat.startAt) {
                                            tryEat();
                                        }
                                    });
}

// Auto-reconnect logic
function attemptReconnect(reason) {
    if (!shouldReconnect || !config.autoReconnect) return;
    if (isReconnecting) {
        console.log("[Reconnect] Already reconnecting...");
        return;
    }

    isReconnecting = true;
    stats.reconnects++;
    console.log("[Reconnect] Waiting " + (config.reconnectDelay / 1000) + "s...");

    setTimeout(() => {
        if (shouldReconnect) {
            console.log("[Reconnect] Connecting...");
            try {
                createBot();
                isReconnecting = false;
            } catch (err) {
                console.log("[Reconnect] Failed: " + err.message);
                isReconnecting = false;
                attemptReconnect("retry");
            }
        } else {
            isReconnecting = false;
        }
    }, config.reconnectDelay);
}

// Graceful shutdown
process.on("SIGINT", () => {
    console.log("\n[Exit] Shutting down...");
    isExiting = true;
    shouldReconnect = false;
    stopJumping();

    try {
        if (bot && bot.quit) bot.quit();
    } catch (e) {}

    rl.close();
    setTimeout(() => process.exit(0), 500);
});

// Start the bot
showWelcome();
createBot();
rl.prompt();
