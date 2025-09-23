const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ========== CONFIG ==========
const TOKEN = process.env.TOKEN;           // <-- lấy token từ biến môi trường
const CHANNEL_ID = "1417744609731154000"; // <-- dán ID kênh bot hoạt động
const ADMIN_ID = "1177116381897039906";     // <-- dán ID Discord của admin

const DATA_FILE = path.join(__dirname, "data.json");
const COOLDOWN_MS = 90 * 1000; // 90 giây cho !daily và !anh tien dz
const BET_WINDOW_MS = 60 * 1000; // 60s cho ván cược 1-13
const SLOT_MIN_BET = 500; // tối thiểu cược slot
const BET_MIN = 100; // tối thiểu cược cho 1-13
const JACKPOT_RATE = 0.30; // 15% khi 3 trùng (xác suất để trả thưởng khi 3 giống)
const MAX_BET = 1e12; // giới hạn để tránh số siêu lớn

// ========= DATA LAYER (balances + cooldowns) =========
let data = {
  balances: {},   // userId -> integer
  cooldowns: {},  // userId -> { daily: ts, anhtien: ts }
  // we don't persist currentBets (runtime only)
};

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      data = JSON.parse(raw);
      // in case file missing sub-objects
      if (!data.balances) data.balances = {};
      if (!data.cooldowns) data.cooldowns = {};
    } catch (e) {
      console.error("Không đọc được data.json, tạo mới:", e);
      data = { balances: {}, cooldowns: {} };
      saveData();
    }
  } else {
    saveData();
  }
}

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Lỗi khi lưu data.json:", e);
  }
}

function getBalance(userId) {
  if (!data.balances[userId]) {
    data.balances[userId] = 1000; // mặc định lần đầu có 1000 xu
    saveData();
  }
  return data.balances[userId];
}
function setBalance(userId, amount) {
  data.balances[userId] = Math.max(0, Math.floor(Number(amount) || 0));
  saveData();
}
function addBalance(userId, amount) {
  getBalance(userId); // ensure exists
  data.balances[userId] = Math.floor(data.balances[userId] + Number(amount));
  saveData();
}
function subtractBalance(userId, amount) {
  getBalance(userId);
  data.balances[userId] = Math.max(0, Math.floor(data.balances[userId] - Number(amount)));
  saveData();
}

function checkCooldown(userId, key, ms = COOLDOWN_MS) {
  if (!data.cooldowns[userId]) data.cooldowns[userId] = {};
  const last = data.cooldowns[userId][key] || 0;
  const now = Date.now();
  if (now - last < ms) {
    return Math.ceil((ms - (now - last)) / 1000); // seconds left
  }
  data.cooldowns[userId][key] = now;
  saveData();
  return 0;
}

// ========= BOT + GAME STATE ==========
loadData();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Betting 1-13 game state
let bettingActive = false;
let currentBets = []; // array of { userId, amount, group } where group = 1 or 2

// utility
function fmt(n) {
  try { return Number(n).toLocaleString(); } catch { return String(n); }
}

// Slot helper (fully random 3 symbols)
function spinSlotRandomRow() {
  const symbols = ["🍒", "🍋", "🍉", "🍇", "🍊", "⭐", "💎"];
  return [
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)]
  ];
}

// When bot ready
client.once("ready", () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

// Message handler - single handler for all commands
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (message.channel.id !== CHANNEL_ID) return; // bot chỉ hoạt động trong 1 kênh

    const raw = message.content.trim();
    if (!raw) return;
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    const userId = message.author.id;

    // ---------- MONEY / UTILITY COMMANDS ----------
    if (cmd === "!sodu" || cmd === "!balance") {
      const b = getBalance(userId);
      return message.reply(`💰 ${message.author.username}, số dư của bạn: **${fmt(b)} xu**`);
    }

    if (cmd === "!daily") {
      const rem = checkCooldown(userId, "daily");
      if (rem > 0) return message.reply(`⏳ Bạn phải chờ ${rem}s để dùng !daily tiếp.`);
      addBalance(userId, 10);
      return message.reply(`🎁 Bạn đã nhận **10 xu** từ !daily. Số dư: **${fmt(getBalance(userId))} xu**`);
    }

    // exact match for "!anh tien dz 1" (user asked that format)
    if (raw.toLowerCase() === "!anh tien dz 1") {
      const rem = checkCooldown(userId, "anhtien");
      if (rem > 0) return message.reply(`⏳ Bạn phải chờ ${rem}s để dùng !anh tien dz 1 tiếp.`);
      addBalance(userId, 50);
      return message.reply(`🔥 Bạn đã nhận **50 xu**! Số dư: **${fmt(getBalance(userId))} xu**`);
    }

    if (cmd === "!pay") {
      const target = message.mentions.users.first();
      const amount = Math.floor(Number(parts[2] || 0));
      if (!target || !Number.isFinite(amount) || amount <= 0) {
        return message.reply("❌ Cú pháp: `!pay @user <số tiền>`");
      }
      if (target.id === userId) return message.reply("🚫 Bạn không thể chuyển tiền cho chính mình.");
      if (getBalance(userId) < amount) return message.reply("🚫 Bạn không đủ xu để chuyển.");
      subtractBalance(userId, amount);
      addBalance(target.id, amount);
      return message.channel.send(`💸 <@${userId}> đã chuyển **${fmt(amount)} xu** cho <@${target.id}>`);
    }

    // admin: addmoney
    if (cmd === "!addmoney") {
      // admin-only
      if (message.author.id !== ADMIN_ID) return message.reply("🚫 Bạn không có quyền dùng lệnh này.");
      const target = message.mentions.users.first();
      const amount = Math.floor(Number(parts[2] || 0));
      if (!target || !Number.isFinite(amount) || amount <= 0) {
        return message.reply("❌ Cú pháp: `!addmoney @user <số tiền>`");
      }
      addBalance(target.id, amount);
      return message.channel.send(`✅ Admin đã cộng **${fmt(amount)} xu** cho ${target.tag}`);
    }

    // admin: removemoney
    if (cmd === "!removemoney") {
      if (message.author.id !== ADMIN_ID) return message.reply("🚫 Bạn không có quyền dùng lệnh này.");
      const target = message.mentions.users.first();
      const amount = Math.floor(Number(parts[2] || 0));
      if (!target || !Number.isFinite(amount) || amount <= 0) {
        return message.reply("❌ Cú pháp: `!removemoney @user <số tiền>`");
      }
      if (getBalance(target.id) < amount) return message.reply("🚫 Người này không đủ xu để trừ.");
      subtractBalance(target.id, amount);
      return message.channel.send(`✅ Admin đã trừ **${fmt(amount)} xu** từ ${target.tag}`);
    }

    // ---------- SLOTS (single row, min bet, 3trùng => x3 with JACKPOT_RATE) ----------
    if (cmd === "!slot" || cmd === "!slots") {
      const bet = Math.floor(Number(parts[1] || 0));
      if (!Number.isFinite(bet) || bet < SLOT_MIN_BET) {
        return message.reply(`❌ Cú pháp: \`!slot <số xu>\` (tối thiểu ${SLOT_MIN_BET} xu)`);
      }
      if (bet > MAX_BET) return message.reply("❌ Số cược quá lớn.");
      if (getBalance(userId) < bet) return message.reply("🚫 Bạn không đủ xu để chơi.");

      // trừ tiền trước
      subtractBalance(userId, bet);

      // random row
      const row = spinSlotRandomRow();
      let reply = `🎰 SLOTS 🎰\n${row.join(" | ")}\n`;

      // nếu 3 trùng
      if (row[0] === row[1] && row[1] === row[2]) {
        // xác suất thực sự trả thưởng JACKPOT_RATE
        if (Math.random() < JACKPOT_RATE) {
          const win = bet * 5;
          addBalance(userId, win);
          reply += `🎉 JACKPOT! Bạn thắng **${fmt(win)} xu** (x5)!`;
        } else {
          reply += `💥 Ra 3 trùng nhưng... xịt (không trả). Thua **${fmt(bet)} xu**.`;
        }
      } else {
        reply += `💀 Không trúng. Bạn mất **${fmt(bet)} xu**.`;
      }
      reply += `\nSố dư: **${fmt(getBalance(userId))} xu**`;
      return message.reply(reply);
    }

    // ---------- 1-13 BETTING (nhóm 1: 1-7, nhóm 2: 8-13) ----------
    // Support both syntaxes: "!bet A 500" or "!bet 500 A"
    if (cmd === "!bet") {
      // minimal parsing
      if (parts.length < 3) {
        return message.reply("❌ Cú pháp: `!bet <A|B> <số tiền>` hoặc `!bet <số tiền> <A|B>` (A = 1-7, B = 8-13).");
      }

      // try interpret both ways
      let group = null; // 1 or 2
      let amount = null;

      // parts[1], parts[2]
      const p1 = parts[1].toUpperCase();
      const p2 = parts[2].toUpperCase();

      // case: bet A 500
      if ((p1 === "A" || p1 === "B") && !isNaN(Number(p2))) {
        group = p1 === "A" ? 1 : 2;
        amount = Math.floor(Number(p2));
      }
      // case: bet 500 A
      else if (!isNaN(Number(p1)) && (p2 === "A" || p2 === "B")) {
        amount = Math.floor(Number(p1));
        group = p2 === "A" ? 1 : 2;
      } else {
        return message.reply("❌ Cú pháp sai. Dùng: `!bet <A|B> <số tiền>` hoặc `!bet <số tiền> <A|B>`.");
      }

      if (amount <= 0 || amount > MAX_BET) return message.reply("❌ Số tiền không hợp lệ.");
      if (amount < BET_MIN) return message.reply(`❌ Số tiền tối thiểu là ${BET_MIN} xu.`);
      if (getBalance(userId) < amount) return message.reply("🚫 Bạn không đủ xu để đặt cược.");

      // trừ ngay khi đặt
      subtractBalance(userId, amount);
      currentBets.push({ userId, amount, group });
      await message.reply(`✅ <@${userId}> đã cược **${fmt(amount)} xu** vào nhóm ${group === 1 ? "A (1–7)" : "B (8–13)"}.\nBạn sẽ biết kết quả sau ${BET_WINDOW_MS/1000}s.`);

      // nếu ván chưa active, start timer
      if (!bettingActive) {
        bettingActive = true;
        await message.channel.send("🎲 Ván cược bắt đầu! Bạn có 60 giây để cược (dùng `!bet`).");

        setTimeout(() => {
          try {
            // tổng từng nhóm
            const total1 = currentBets.filter(b => b.group === 1).reduce((s,b)=>s+b.amount, 0);
            const total2 = currentBets.filter(b => b.group === 2).reduce((s,b)=>s+b.amount, 0);

            // quyết định nhóm thắng theo rule: nhóm nhiều tiền hơn => 25% cơ hội thắng
            let winningGroup;
            if (total1 > total2) {
              // group1 nhiều hơn -> chỉ 25% chance thắng
              winningGroup = (Math.random() < 0.25) ? 1 : 2;
            } else if (total2 > total1) {
              // group2 nhiều hơn -> only 25% chance win for group2
              winningGroup = (Math.random() < 0.25) ? 2 : 1;
            } else {
              // tie -> 50/50
              winningGroup = (Math.random() < 0.5) ? 1 : 2;
            }

            // compose result and payouts
            let summary = `📊 Kết quả ván cược:\n- Tổng A (1–7): ${fmt(total1)} xu\n- Tổng B (8–13): ${fmt(total2)} xu\n→ Nhóm thắng: **${winningGroup === 1 ? "A (1–7)" : "B (8–13)"}**\n\n`;

            let payouts = [];
            if (currentBets.length === 0) {
              message.channel.send("⚠️ Không có ai cược.");
            } else {
              for (const bet of currentBets) {
                if (bet.group === winningGroup) {
                  const win = bet.amount * 2; // trả 2x
                  addBalance(bet.userId, win);
                  payouts.push(`<@${bet.userId}> thắng **${fmt(win)} xu**`);
                } else {
                  payouts.push(`<@${bet.userId}> thua **${fmt(bet.amount)} xu**`);
                }
              }
              message.channel.send(summary + payouts.join("\n"));
            }
          } catch (err) {
            console.error("Lỗi khi resolve ván cược:", err);
            message.channel.send("⚠️ Có lỗi khi xử lý ván cược.");
          } finally {
            // reset
            currentBets = [];
            bettingActive = false;
            saveData();
          }
        }, BET_WINDOW_MS);
      }

      return;
    } // end !bet

    // optional: leaderboard or balances list could be added here

  } catch (err) {
    console.error("Error in message handler:", err);
  }
});

// ===== start bot
client.login(TOKEN).catch(err => {
  console.error("Không thể login bot — kiểm tra TOKEN:", err);
});

// ========== PHẦN THÊM CHO RENDER ==========
// Tạo HTTP server đơn giản để Render detect port
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Discord bot is running on Render!');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
  console.log(`✅ Bot is ready to connect to Discord`);
});

