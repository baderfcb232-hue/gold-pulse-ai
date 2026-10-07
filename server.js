const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// ضع معلومات بوت التلغرام الخاص بك هنا (مجاني 100%)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ""; 
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let latestSignal = {
    symbol: "XAUUSD",
    broker: "JustMarket MT5",
    type: "WAIT",
    entry: 0,
    sl: 0,
    tp1: 0,
    tp2: 0,
    tp3: 0,
    spread: 1.2,
    engine: "Zero Drawdown Sniper (M1)",
    updatedAt: new Date().toISOString()
};

async function sendTelegramMessage(signal) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    const emoji = signal.type === 'BUY' ? '🟢 شراء قوي (BUY)' : '🔴 بيع قوي (SELL)';
    const text = `⚡ *GOLD PULSE AI - صفقة قناصة* ⚡\n\n` +
                 `📊 *الزوج:* ${signal.symbol} (${signal.broker})\n` +
                 `🎯 *الإشارة:* ${emoji}\n` +
                 `📍 *سعر الدخول:* \`${signal.entry}\`\n` +
                 `🛑 *وقف الخسارة (SL):* \`${signal.sl}\`\n\n` +
                 `🎯 *الهدف الأول (TP1):* \`${signal.tp1}\`\n` +
                 `🎯 *الهدف الثاني (TP2):* \`${signal.tp2}\`\n` +
                 `🎯 *الهدف الثالث (TP3):* \`${signal.tp3}\`\n\n` +
                 `📉 *السبريد:* ${signal.spread} pips\n` +
                 `⚡ *النوع:* صفر انعكاس (Zero Drawdown)`;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        console.error("Telegram error:", e);
    }
}

app.post('/api/signal', async (req, res) => {
    console.log("New Signal Inbound:", req.body);
    latestSignal = { ...req.body, updatedAt: new Date().toISOString() };
    
    if (req.body.type === 'BUY' || req.body.type === 'SELL') {
        await sendTelegramMessage(latestSignal);
    }

    res.status(200).json({ status: "success", message: "Signal pushed to Web & Telegram" });
});

app.get('/api/signal', (req, res) => {
    res.status(200).json(latestSignal);
});

app.listen(PORT, () => {
    console.log(`⚡ GOLD PULSE AI Engine running on port ${PORT}`);
});
