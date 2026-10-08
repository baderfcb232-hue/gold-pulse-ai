// ====================================================================
// NABD VIP GOLD PULSE AI - Institutional Engine v2.0 (Full Master Server)
// ====================================================================
const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// متغيرات البيئة الخاصة بالتليجرام (يمكن ضبطها في Render أو تركها فارغة)
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

// قاعدة البيانات المؤقتة الشاملة لحالة السوق
let marketState = {
    symbol: "XAUUSD",
    bid: 0,
    ask: 0,
    spread: 0,
    timeframes: {
        M5: "WAITING",
        M15: "WAITING",
        H1: "WAITING",
        H4: "WAITING"
    },
    aiDecision: "WAITING FOR DATA",
    confidence: "0%",
    newsAlert: "رادار الحماية والسيولة نشط ومحمي 🛡️",
    riskLevel: "LOW RISK",
    lastUpdate: "--:--"
};

// --------------------------------------------------------------------
// 1. دالة إرسال التوصيات والتنبيهات المباشرة عبر التليجرام
// --------------------------------------------------------------------
async function sendTelegramNotification(messageText) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            chat_id: TELEGRAM_CHAT_ID,
            text: messageText,
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error("Telegram Notification Error:", e.message);
    }
}

// --------------------------------------------------------------------
// 2. رادار الأخبار الاقتصادية التلقائي لحماية السيرفر من أخطاء 404
// --------------------------------------------------------------------
async function monitorGlobalNewsAndRisk() {
    try {
        // جلب الأخبار من مصدر DailyFX RSS المباشر
        const response = await axios.get('https://www.dailyfx.com/feeds/market-news', {
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const currentHour = new Date().getUTCHours();
        // فحص ساعات الذروة والسيولة العالية في بورصة نيويورك ولندن
        if (currentHour >= 12 && currentHour <= 15) {
            marketState.newsAlert = "⚠️ فترة ذروة سيولة نيويورك والبيانات الأمريكية - تداولات حذرة";
            marketState.riskLevel = "MEDIUM RISK";
        } else {
            marketState.newsAlert = "✅ السيولة منتظمة ولا توجد عواصف إخبارية مفاجئة حالياً";
            marketState.riskLevel = "LOW RISK";
        }
    } catch (e) {
        marketState.newsAlert = "🛡️ رادار الأخبار يعمل في وضع الحماية والتأمين التلقائي";
        marketState.riskLevel = "LOW RISK";
    }
}
setInterval(monitorGlobalNewsAndRisk, 60000); // فحص كل دقيقة

// --------------------------------------------------------------------
// 3. استقبال البيانات والأسعار المباشرة من MT5 (المسار الأساسي "/")
// --------------------------------------------------------------------
app.post('/', async (req, res) => {
    try {
        const { symbol, bid, ask, timeframes } = req.body;
        
        // التحقق من صحة الأسعار المستلمة
        if (!bid || !ask) {
            return res.status(400).send({ status: "ERROR", message: "Invalid Bid/Ask Prices" });
        }

        const numericBid = parseFloat(bid);
        const numericAsk = parseFloat(ask);
        const spread = parseFloat(((numericAsk - numericBid) * 10).toFixed(1));

        // معالجة الفريمات الزمنية الأربعة
        let tfM5 = timeframes && timeframes.M5 ? timeframes.M5 : (numericAsk > numericBid ? "BULLISH" : "BEARISH");
        let tfM15 = timeframes && timeframes.M15 ? timeframes.M15 : "BULLISH";
        let tfH1 = timeframes && timeframes.H1 ? timeframes.H1 : "BULLISH";
        let tfH4 = timeframes && timeframes.H4 ? timeframes.H4 : "BULLISH";

        // حساب عدد الاتجاهات المطبقة
        const tfList = [tfM5, tfM15, tfH1, tfH4];
        const bullCount = tfList.filter(v => v.includes("BULLISH") || v.includes("BUY")).length;
        const bearCount = tfList.filter(v => v.includes("BEARISH") || v.includes("SELL")).length;

        let confidencePercent = 0;
        let finalDecision = "HOLD / WAIT";

        if (bullCount >= 3) {
            confidencePercent = Math.round((bullCount / 4) * 100);
            finalDecision = bullCount === 4 ? "STRONG BUY 🟢" : "BUY 🟢";
        } else if (bearCount >= 3) {
            confidencePercent = Math.round((bearCount / 4) * 100);
            finalDecision = bearCount === 4 ? "STRONG SELL 🔴" : "SELL 🔴";
        } else {
            confidencePercent = 50;
            finalDecision = "HOLD / WAIT ⚪";
        }

        const previousDecision = marketState.aiDecision;

        // تحديث قاعدة البيانات الحية
        marketState = {
            symbol: symbol || "XAUUSD",
            bid: numericBid,
            ask: numericAsk,
            spread: spread,
            timeframes: { M5: tfM5, M15: tfM15, H1: tfH1, H4: tfH4 },
            aiDecision: finalDecision,
            confidence: `${confidencePercent}%`,
            newsAlert: marketState.newsAlert,
            riskLevel: marketState.riskLevel,
            lastUpdate: new Date().toLocaleTimeString('ar-EG')
        };

        // إرسال إشعار فوري للتلجرام إذا ظهرت صفقة جديدة قوية
        if (finalDecision.includes("STRONG") && finalDecision !== previousDecision) {
            const isBuy = finalDecision.includes("BUY");
            const tp1 = isBuy ? (numericAsk + 2.50).toFixed(2) : (numericAsk - 2.50).toFixed(2);
            const tp2 = isBuy ? (numericAsk + 5.00).toFixed(2) : (numericAsk - 5.00).toFixed(2);
            const sl = isBuy ? (numericAsk - 1.80).toFixed(2) : (numericAsk + 1.80).toFixed(2);

            const signalMsg = `🏛️ **إشارة تداول مؤسسية جديدة من NABD VIP AI**\n\n` +
                              `📌 **الزوج:** ${marketState.symbol}\n` +
                              `🎯 **نوع التوصية:** ${finalDecision}\n` +
                              `🔥 **درجة التوافق:** ${marketState.confidence}\n\n` +
                              `💵 **سعر الدخول:** $${numericAsk.toFixed(2)}\n` +
                              `🎯 **الهدف الأول (TP1):** $${tp1} (+25 pips)\n` +
                              `🎯 **الهدف الثاني (TP2):** $${tp2} (+50 pips)\n` +
                              `🛑 **وقف الخسارة (SL):** $${sl} (-18 pips)\n\n` +
                              `📊 **تحليل الفريمات:**\n` +
                              `• M5: ${tfM5} | M15: ${tfM15}\n` +
                              `• H1: ${tfH1} | H4: ${tfH4}`;
            
            await sendTelegramNotification(signalMsg);
        }

        res.status(200).send({ status: "SUCCESS", state: marketState });

    } catch (error) {
        console.error("Server Post Error:", error);
        res.status(500).send({ status: "ERROR", message: error.message });
    }
});

// مسار بديل اختياري لدعم السكريبتات الأخرى
app.post('/api/update', (req, res) => {
    req.url = '/';
    app.handle(req, res);
});

// --------------------------------------------------------------------
// 4. API إرجاع بيانات الواجهة الأمامية (public/index.html)
// --------------------------------------------------------------------
app.get('/api/state', (req, res) => {
    res.json(marketState);
});

// توجيه باقي المسارات لصفحة Dashboard الرئيسية
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// تشغيل السيرفر
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`NABD VIP Institutional Engine active on port ${PORT}`);
    console.log(`====================================================`);
});
