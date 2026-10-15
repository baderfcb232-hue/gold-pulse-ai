export function createAuthMailer({apiKey, from, publicBase, smtp, fetcher = fetch}) {
  let transport;
  return async ({email, kind, token}) => {
    const subjects = {verify: 'تأكيد بريدك في نبض', reset: 'استعادة كلمة مرور نبض', login: 'تسجيل دخول جديد إلى نبض'};
    const link = token ? `${publicBase.replace(/\/$/, '')}/auth#${kind}=${encodeURIComponent(token)}` : `${publicBase}/account`;
    const text = kind === 'login' ? 'تم تسجيل دخول جديد إلى حسابك. إذا لم تكن أنت، غيّر كلمة المرور وأنهِ الجلسات من صفحة حسابي.'
      : kind === 'verify' ? 'لتأكيد بريدك اضغط الرابط خلال 24 ساعة. إذا لم تطلب إنشاء الحساب تجاهل الرسالة.'
        : 'لتغيير كلمة المرور اضغط الرابط خلال 30 دقيقة. إذا لم تطلب الاستعادة تجاهل الرسالة.';
    if (smtp) {
      if (!transport) {const nodemailer = await import('nodemailer'); transport = nodemailer.default.createTransport({...smtp,
        requireTLS: !smtp.secure, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000});}
      await transport.sendMail({from, to: email, subject: subjects[kind], text: text + '\n\n' + link}); return;
    }
    const response = await fetcher('https://api.resend.com/emails', {method: 'POST', signal: AbortSignal.timeout(10000),
      headers: {'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({from, to: [email], subject: subjects[kind], text: text + '\n\n' + link})});
    if (!response.ok) throw Error('Email provider unavailable');
  };
}
