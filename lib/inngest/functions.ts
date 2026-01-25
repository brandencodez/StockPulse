import { inngest } from "@/lib/inngest/client";
import { sendWhatsAppMessage } from "@/lib/twilio/sendWhatsApp.mjs";
import Groq from "groq-sdk";
import {
  NEWS_SUMMARY_EMAIL_PROMPT,
  PERSONALIZED_WELCOME_EMAIL_PROMPT,
} from "@/lib/inngest/prompts";
import { sendNewsSummaryEmail, sendWelcomeEmail } from "@/lib/nodemailer";
import { getAllUsersForNewsEmail } from "@/lib/actions/user.actions";
import { getWatchlistSymbolsByEmail } from "@/lib/actions/watchlist.actions";
import { getNews } from "@/lib/actions/finnhub.actions";
import { getFormattedTodayDate } from "@/lib/utils";

// Initialize Groq client
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });


type UserForNewsEmail = {
  email: string;
  userId: string;
  name?: string;
  phone?: string;
  country?: string;
  investmentGoals?: string;
  riskTolerance?: string;
  preferredIndustry?: string;
};

type MarketNewsArticle = {
  id?: string | number;
  symbol?: string;
  datetime?: number | string;
  headline?: string;
  summary?: string;
  url?: string;
  source?: string;
  image?: string;
};

function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<h3[^>]*>(.*?)<\/h3>/g, "\n📊 *$1*\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/g, "\n🔹 *$1*\n")
    .replace(/<li[^>]*>(.*?)<\/li>/g, "• $1\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeTrim(text: string, limit = 1500): string {
  if (text.length <= limit) return text;
  const cutoff = text.lastIndexOf(".", limit);
  return cutoff > 0 ? text.substring(0, cutoff + 1) : text.slice(0, limit);
}

// Welcome Email
export const sendSignUpEmail = inngest.createFunction(
  { id: "sign-up-email" },
  { event: "app/user.created" },
  async ({ event, step }) => {
    const { country, investmentGoals, riskTolerance, preferredIndustry, email, name } = event.data;

    const userProfile = `
      - Country: ${country}
      - Investment goals: ${investmentGoals}
      - Risk tolerance: ${riskTolerance}
      - Preferred industry: ${preferredIndustry}
    `;

    const prompt = PERSONALIZED_WELCOME_EMAIL_PROMPT.replace(
      "{{userProfile}}",
      userProfile
    );

    // Generate personalized intro with Groq
    const introText = await step.run("generate-welcome-intro", async () => {
      const completion = await groq.chat.completions.create({
        model: "moonshotai/kimi-k2-instruct-0905",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5,
        max_tokens: 400,
      });
      return (
        completion.choices[0]?.message?.content ||
        "Thanks for joining StockPulse. You now have the tools to track markets and make smarter moves."
      );
    });

    //Send welcome email
    await step.run("send-welcome-email", async () => {
      await sendWelcomeEmail({ email, name, intro: introText });
    });

    return {
      success: true,
      message: "Welcome email sent successfully",
    };
  }
);

// Daily News Summary
export const sendDailyNewsSummary = inngest.createFunction(
  { id: "daily-news-summary" },
  [{ event: "app/send.daily.news" }, { cron: "0 12 * * *"  }], // daily at 12:00 UTC
  async ({ step }) => {
    //Get all users
    const users = await step.run("get-all-users", getAllUsersForNewsEmail);
    if (!users || users.length === 0) {
      return { success: false, message: "No users found for news email" };
    }

    // Fetch user-specific news
    const results = await step.run("fetch-user-news", async () => {
      const perUser: Array<{ user: UserForNewsEmail; articles: MarketNewsArticle[] }> = [];

      for (const user of users as UserForNewsEmail[]) {
        try {
          const symbols = await getWatchlistSymbolsByEmail(user.email);
          let articles: MarketNewsArticle[] = [];

          if (Array.isArray(symbols) && symbols.length > 0) {
            const articlesBySymbol = await Promise.all(
              symbols.map(async (s) => ({
                symbol: s,
                articles: (await getNews(s)) || [],
              }))
            );

            const targetTotal = 6;
            const minPerSymbol = Math.min(2, Math.floor(targetTotal / symbols.length));
            const balanced: MarketNewsArticle[] = [];

            // Take minimum per symbol
            for (const { articles: symbolArticles } of articlesBySymbol) {
              balanced.push(...symbolArticles.slice(0, minPerSymbol));
            }

            // Fill remaining slots by interleaving
            const remaining = targetTotal - balanced.length;
            if (remaining > 0) {
              const interleaved: MarketNewsArticle[] = [];
              const maxIndex = Math.max(...articlesBySymbol.map((s) => s.articles.length));
              for (let i = minPerSymbol; i < maxIndex && interleaved.length < remaining; i++) {
                for (const { articles: symbolArticles } of articlesBySymbol) {
                  if (symbolArticles[i] && interleaved.length < remaining) {
                    interleaved.push(symbolArticles[i]);
                  }
                }
              }
              balanced.push(...interleaved);
            }

            articles = balanced.slice(0, targetTotal);
          } else {
            // Fallback: general market news
            articles = (await getNews())?.slice(0, 6) || [];
          }

          perUser.push({ user, articles });
        } catch (e) {
          console.error("❌ Error preparing user news", user.email, e);
          perUser.push({ user, articles: [] });
        }
      }
      return perUser;
    });

    //Generate summaries
    const userNewsSummaries = await step.run("generate-summaries", async () => {
      const summaries: {
        user: UserForNewsEmail;
        htmlSummary: string | null;
        plainSummary: string | null;
      }[] = [];

      for (const { user, articles } of results) {
        try {
          const prompt = NEWS_SUMMARY_EMAIL_PROMPT.replace(
            "{{newsData}}",
            JSON.stringify(articles, null, 2)
          );

          const htmlSummary = await groq.chat.completions.create({
            model: "moonshotai/kimi-k2-instruct-0905",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
            max_tokens: 1500,
          }).then((res) => res.choices[0]?.message?.content || "No market news.");

          const plainSummary = htmlToPlainText(htmlSummary);
          summaries.push({ user, htmlSummary, plainSummary });
        } catch (e) {
          console.error("⚠️ Failed to summarize news for:", user.email, e);
          summaries.push({ user, htmlSummary: null, plainSummary: null });
        }
      }
      return summaries;
    });

    // Send emails
    await step.run("send-news-emails", async () => {
      await Promise.all(
        userNewsSummaries.map(async ({ user, htmlSummary }) => {
          if (htmlSummary) {
            await sendNewsSummaryEmail({
              email: user.email,
              date: getFormattedTodayDate(),
              newsContent: htmlSummary,
            });
          }
        })
      );
    });

    // Send WhatsApp messages
    await step.run("send-news-whatsapp", async () => {
      await Promise.all(
        userNewsSummaries.map(async ({ user, plainSummary }) => {
          if (!plainSummary) return;
          const phone = user.phone || process.env.TEST_PHONE_NUMBER;
          if (!phone) return;

          const shortSummary = safeTrim(plainSummary);
          await sendWhatsAppMessage(
            phone,
            `📈 *Daily Market Summary (${getFormattedTodayDate()})*\n\n${shortSummary}`
          );
        })
      );
    });

    return {
      success: true,
      message: "✅ Daily news summary emails and WhatsApp alerts sent successfully",
    };
  }
);