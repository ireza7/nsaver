import TelegramBot from "node-telegram-bot-api";
import { ensureUser } from "../../services/user.js";
import { createLogger } from "../../utils/index.js";
import { env } from "../../config/env.js";

const log = createLogger("handler:start");

const WELCOME_TEXT = `
🎌 *nsaver Bot*

دانلود و مدیریت علاقه‌مندی‌های nhentai

*دستورات:*
/start \\- نمایش این پیام
/session \\- تنظیم سشن nhentai
/export \\- دریافت PDF از علاقه‌مندی‌ها
/filter \\- فیلتر بر اساس تگ
/get \\- دریافت هنتای با کد \\(مثلاً /get 177013\\)
/status \\- وضعیت سشن فعلی
/help \\- راهنمای کامل

*نحوه استفاده:*
1\\. ابتدا با /session اطلاعات سشن خود را ارسال کنید
2\\. سپس با /export فایل PDF علاقه‌مندی‌ها را دریافت کنید
3\\. با /filter می‌توانید تگ‌های خاصی را فیلتر کنید
4\\. با /get یا فرستادن عدد کد، یک هنتای خاص را دریافت کنید
`;

export function registerStartHandler(bot: TelegramBot): void {
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id;
    if (!telegramId) return;

    // Check admin restriction
    if (
      env.ADMIN_USER_IDS.length > 0 &&
      !env.ADMIN_USER_IDS.includes(telegramId)
    ) {
      await bot.sendMessage(chatId, "⛔ Access denied.");
      return;
    }

    try {
      await ensureUser(
        telegramId,
        msg.from?.username,
        msg.from?.first_name
      );

      await bot.sendMessage(chatId, WELCOME_TEXT, {
        parse_mode: "MarkdownV2",
      });
    } catch (err: any) {
      log.error("Start handler error:", err.message);
      await bot.sendMessage(chatId, "❌ An error occurred. Please try again.");
    }
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, WELCOME_TEXT, {
      parse_mode: "MarkdownV2",
    });
  });
}
