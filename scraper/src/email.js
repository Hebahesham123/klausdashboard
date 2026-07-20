import nodemailer from 'nodemailer';
import 'dotenv/config';

const enabled = process.env.EMAIL_ENABLED === 'true';

let transporter = null;
if (enabled) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

function carRow(c) {
  const price = c.priceText || (c.priceValue != null ? `$${c.priceValue}` : 'N/A');
  const bits = [c.mileage, c.city, c.postedText].filter(Boolean).join(' · ');
  return `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;">
        ${c.imageUrl ? `<img src="${c.imageUrl}" width="120" style="border-radius:8px;display:block;">` : ''}
      </td>
      <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top;font-family:Arial,sans-serif;">
        <div style="font-size:16px;font-weight:bold;color:#111;">${c.title || 'Car'}</div>
        <div style="font-size:18px;color:#1a7f37;font-weight:bold;margin:4px 0;">${price}</div>
        <div style="font-size:13px;color:#555;">${bits}</div>
        <a href="${c.url}" style="display:inline-block;margin-top:8px;padding:8px 14px;background:#1877f2;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">View on Facebook →</a>
      </td>
    </tr>`;
}

/** Email a batch of newly-found cars. No-op if EMAIL_ENABLED is not "true". */
export async function sendNewCarsEmail(cars) {
  if (!enabled || !transporter || cars.length === 0) return;

  const subject =
    cars.length === 1
      ? `🚗 New car: ${cars[0].title || 'listing'} — ${cars[0].priceText || ''}`
      : `🚗 ${cars.length} new cars on Marketplace`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;">
      <h2 style="color:#111;">${cars.length} new car${cars.length > 1 ? 's' : ''} matched your filters</h2>
      <table style="width:100%;border-collapse:collapse;">${cars.map(carRow).join('')}</table>
      <p style="font-size:12px;color:#888;margin-top:16px;">Sent by your GAD Marketplace Dashboard.</p>
    </div>`;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM,
      to: process.env.EMAIL_TO,
      subject,
      html,
    });
    console.log(`  Email sent for ${cars.length} new car(s).`);
  } catch (err) {
    console.error('  Email failed:', err.message);
  }
}
