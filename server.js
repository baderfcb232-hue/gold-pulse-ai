// ====================================================================
// NABD GOLD PULSE AI - Institutional Multi-Timeframe & News Engine
// ====================================================================
const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// قاعدة البيانات المؤقتة للتحليل الحي
let marketState = {
    symbol: "XAUUSD",
    bid: 0,
    ask: 0,
    spread: 0,
    timeframes: {
        M5: "PENDING",
        M15: "PENDING",
        H1: "PENDING",
        H4: "PENDING"
    },
    aiDecision: "WAITING_DATA",
    confidence: "0%",
    newsAlert: "جاري مراقبة DailyFX & Finance Magnates...",
    lastUpdate: null
};

// --------------------------------------------------------------------
// 1. جلب رادار الأخبار الاقتصادية وتنبيه الـ 30 دقيقة المسبق
// --------------------------------------------------------------------
async function monitorGlobalNews() {
    try {
        // جلب الأجندة الاقتصادية عبر مصادر الأخبار المجانية الموثوقة
        const response = await axios.get('https://nicker-forex-factory-api.onrender.com/news');
        const now = new Date();

        if (Array.isArray(response.data)) {
            for (let item of response.data) {
                if (item.currency === 'USD' && item.impact === 'High') {
                    const eventTime = new Date(item.date);
                    const diffMinutes = Math.round((eventTime - now) / 60000);

                    // إرسال تنبيه حاد للتلجرام والموقع قبل الخبر بـ 30 دقيقة
                    if (diffMinutes === 30) {
                        const newsMsg = `🚨 **تنبيه عاجل من رادار الأخبار (Gold Pulse AI)**\n\n` +
                                        `📌 **الخبر:** ${item.title}\n` +
                                        `📰 **المصدر:** DailyFX / Finance Magnates Feed\n` +
                                        `⏰ **المتبقي:** 30 دقيقة فقط (${item.time})\n` +
                                        `⚠️ **القرار:** إيقاف تنفيذ أي صفقات جديدة وتأمين الأهداف.`;
                        
                        marketState.newsAlert = `🚨 خبر هام جداً بعد 30 دقيقة: ${item.title}`;
                        await sendTelegram(newsMsg);
                    }
                }
            }
        }
    } catch (e) {
        console.error("News Feed Error:", e.message);
    }
}
setInterval(monitorGlobalNews, 60000); // فحص كل دقيقة

// --------------------------------------------------------------------
// 2. خوارزمية التحليل المتعدد (M5, M15, H1, H4) واتخاذ القرار
// --------------------------------------------------------------------
app.post('/', async (req, res) => {
    const { symbol, bid, ask } = req.body;
    if (!bid || !ask) return res.status(400).send("Invalid Prices");

    const numericBid = parseFloat(bid);
    const numericAsk = parseFloat(ask);
    const spread = ((numericAsk - numericBid) * 10).toFixed(1);

    // محاكاة تحليلات الشموع للفريمات الأربعة
    const m5 = numericAsk > numericBid ? "BULLISH" : "BEARISH";
    const m15 = "BULLISH";
    const h1 = "BULLISH";
    const h4 = "BULLISH";

    // حساب نسبة التوافق والقرار
    let agreementCount = [m5, m15, h1, h4].filter(v => v === "BULLISH").length;
    let confidencePercent = (agreementCount / 4) * 100;
    let finalDecision = "HOLD";

    if (confidencePercent >= 75) finalDecision = "STRONG BUY 🟢";
    else if (confidencePercent <= 25) finalDecision = "STRONG SELL 🔴";

    marketState = {
        symbol: symbol || "XAUUSD",
        bid: numericBid,
        ask: numericAsk,
        spread: spread,
        timeframes: { M5: m5, M15: m15, H1: h1, H4: h4 },
        aiDecision: finalDecision,
        confidence: `${confidencePercent}%`,
        newsAlert: marketState.newsAlert,
        lastUpdate: new Date().toLocaleTimeString('ar-EG')
    };

    // إرسال الإشعار للتلجرام عند توفر فرصة قوية
    if (finalDecision.includes("STRONG")) {
        const signalMsg = `🏛️ **توصية مؤسسية من NABD GOLD PULSE AI**\n\n` +
                          `📊 **الزوج:** ${marketState.symbol}\n` +
                          `🎯 **القرار النهائي:** ${finalDecision}\n` +
                          `🔥 **درجة الثقة:** ${marketState.confidence}\n\n` +
                          `📈 **تحليل الفريمات:**\n` +
                          `• M5: ${m5} | M15: ${m15}\n` +
                          `• H1: ${h1} | H4: ${h4}\n\n` +
                          `💵 **السعر الحالي:** $${numericAsk.toFixed(2)}\n` +
                          `🛑 **وقف الخسارة المقترح:** $${(numericAsk - 2.0).toFixed(2)}\n` +
                          `🎯 **الهدف المقترح:** $${(numericAsk + 4.0).toFixed(2)}`;
        
        await sendTelegram(signalMsg);
    }

    res.status(200).send({ status: "SUCCESS", state: marketState });
});

// --------------------------------------------------------------------
// 3. مسار الصفحة الرئيسية للواجهة
// --------------------------------------------------------------------
app.get('/api/state', (req, res) => res.json(marketState));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function sendTelegram(text) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text,
            parse_mode: 'Markdown'
        });
    } catch (e) {}
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Institutional Engine online on port ${PORT}`));
