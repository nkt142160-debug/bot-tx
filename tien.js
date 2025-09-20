const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

// ================== CONFIG ==================
const TOKEN = "MTQxNzg4OTM1ODQxNzEwNDk2Ng.GrTc_h.c2m2qrAP0uOzHRjOQcFzM7zFgfTCwuA3eXq3PA"; // 🔑 Thay bằng token bot của bạn
const CHANNEL_ID = "1418100033466667122"; // 🏠 ID kênh chat
// =============================================

// Tạo client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

// Đọc dữ liệu số dư
let balances = {};
if (fs.existsSync("balances.json")) {
    balances = JSON.parse(fs.readFileSync("balances.json"));
}

// Lưu dữ liệu số dư
function saveBalances() {
    fs.writeFileSync("balances.json", JSON.stringify(balances, null, 2));
}

// Thêm tiền
function addBalance(userId, amount) {
    if (!balances[userId]) balances[userId] = 0;
    balances[userId] += amount;
    saveBalances();
}

// Trừ tiền
function removeBalance(userId, amount) {
    if (!balances[userId]) balances[userId] = 0;
    balances[userId] -= amount;
    if (balances[userId] < 0) balances[userId] = 0;
    saveBalances();
}

// Random slot (3 ô bất kỳ)
function spinSlot() {
    const symbols = ["🍒", "🍋", "🍉", "🍇", "⭐", "7️⃣"];
    return [
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
    ];
}

// Khi bot sẵn sàng
client.once("ready", () => {
    console.log(`✅ Bot đã đăng nhập với tên: ${client.user.tag}`);
});

// Xử lý lệnh
client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (message.channel.id !== CHANNEL_ID) return;

    const args = message.content.split(" ");
    const cmd = args[0].toLowerCase();

    // Xem số dư
    if (cmd === "!balance" || cmd === "!sodu") {
        const bal = balances[message.author.id] || 0;
        return message.reply(`💰 Số dư của bạn: **${bal} xu**`);
    }

    // Cộng tiền (test nhanh)
    if (cmd === "!addmoney") {
        const amount = parseInt(args[1]);
        if (isNaN(amount)) return message.reply("❌ Cú pháp: `!addmoney <số tiền>`");

        addBalance(message.author.id, amount);
        return message.reply(`✅ Bạn đã được cộng **${amount} xu**`);
    }

    // Slot machine
    if (cmd === "!slot") {
        const bet = parseInt(args[1]);
        if (isNaN(bet) || bet < 500) {
            return message.reply("⚠️ Cược tối thiểu là **500 xu**");
        }

        const bal = balances[message.author.id] || 0;
        if (bal < bet) return message.reply("❌ Bạn không đủ xu để chơi.");

        removeBalance(message.author.id, bet);

        const result = spinSlot();
        let reward = 0;
        let msg = `🎰 ${result.join(" | ")} 🎰\n`;

        // Nếu cả 3 giống nhau
        if (result[0] === result[1] && result[1] === result[2]) {
            if (Math.random() < 1) { // 15% Jackpot
                reward = bet * 3;
                msg += `🎉 Jackpot! Bạn thắng **${reward} xu** (x3)!`;
            } else {
                msg += `💀 Suýt trúng Jackpot nhưng xịt rồi 😭. Mất **${bet} xu**.`;
            }
        } else {
            msg += `💀 Thua rồi! Mất **${bet} xu**.`;
        }

        addBalance(message.author.id, reward);
        return message.reply(msg);
    }
});

// Login bot
client.login(TOKEN);