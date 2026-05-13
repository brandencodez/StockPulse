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

type PromptNewsArticle = {
  symbol?: string;
  datetime?: number | string;
  headline?: string;
  summary?: string;
  source?: string;
  url?: string;
};

const CHARS_PER_TOKEN_ESTIMATE = 4;
const NEWS_SUMMARY_MAX_OUTPUT_TOKENS = 1000;
const NEWS_SUMMARY_TOTAL_TOKEN_BUDGET = 5600;
const NEWS_SUMMARY_INPUT_CHAR_BUDGET =
  (NEWS_SUMMARY_TOTAL_TOKEN_BUDGET - NEWS_SUMMARY_MAX_OUTPUT_TOKENS) *
  CHARS_PER_TOKEN_ESTIMATE;

const REASONING_LEAK_PATTERNS = [
  /(^|\n)\s*okay,?\s+let'?s/i,
  /(^|\n)\s*first,?\s+i\s+need\s+to/i,
  /(^|\n)\s*the\s+user\s+wants\s+me\s+to/i,
  /(^|\n)\s*i\s+should\s+/i,
  /(^|\n)\s*my\s+task\s+is/i,
  /<think[\s\S]*?<\/think>/i,
];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeModelOutput(raw: string): string {
  if (!raw) return "";

  let cleaned = raw
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/<think[\s\S]*?<\/think>/gi, "")
    .trim();

  if (cleaned.includes("<html") || cleaned.includes("<!DOCTYPE")) {
    const bodyMatch = cleaned.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch?.[1]) {
      cleaned = bodyMatch[1].trim();
    }
  }

  const firstTag = cleaned.indexOf("<");
  if (firstTag > 0) {
    cleaned = cleaned.slice(firstTag).trim();
  }

  return cleaned;
}

function hasReasoningLeak(text: string): boolean {
  return REASONING_LEAK_PATTERNS.some((pattern) => pattern.test(text));
}

function looksLikeStructuredNewsHtml(html: string): boolean {
  return (
    /<h3[^>]*>/.test(html) &&
    /<div class="dark-info-box"/.test(html) &&
    /Read Full Story/.test(html)
  );
}

function extractHeadlineInsight(summary: string): string {
  const cleaned = summary.replace(/\s+/g, " ").trim();
  if (!cleaned) return "New development from your watchlist that may impact near-term price action.";

  const sentenceEnd = cleaned.search(/[.!?]/);
  if (sentenceEnd > 0) {
    return safeTrim(cleaned.slice(0, sentenceEnd + 1), 140);
  }

  return safeTrim(cleaned, 140);
}

function formatDateHint(datetime?: number | string): string {
  if (!datetime) return "Published recently.";

  const numericValue = typeof datetime === "string" ? Number(datetime) : datetime;
  const millis = Number.isFinite(numericValue)
    ? Number(numericValue) < 10_000_000_000
      ? Number(numericValue) * 1000
      : Number(numericValue)
    : NaN;

  if (!Number.isFinite(millis)) return "Published recently.";

  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "Published recently.";

  return `Published ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}.`;
}

function toValidUrl(url?: string): string {
  if (!url) return "#";
  return /^https?:\/\//i.test(url) ? url : "#";
}

function buildFallbackNewsHtml(articles: MarketNewsArticle[]): string {
  if (!articles || articles.length === 0) {
    return `<h3 class="mobile-news-title dark-text" style="margin: 30px 0 15px 0; font-size: 18px; font-weight: 600; color: #f8f9fa; line-height: 1.3;">📊 Watchlist News</h3>
<p class="mobile-text dark-text-secondary" style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #CCDADC;">No major updates were found for your watchlist today. We will send fresh headlines as soon as new market-moving stories are published.</p>`;
  }

  const cards = articles.slice(0, 6).map((article) => {
    const symbol = escapeHtml(article.symbol || "WATCHLIST");
    const headline = escapeHtml(
      safeTrim(article.headline || "Watchlist company update", 110)
    );
    const source = escapeHtml(article.source || "market source");
    const summary = extractHeadlineInsight(article.summary || "");
    const safeSummary = escapeHtml(summary);
    const dateHint = escapeHtml(formatDateHint(article.datetime));
    const url = escapeHtml(toValidUrl(article.url));

    return `<div class="dark-info-box" style="background-color: #212328; padding: 24px; margin: 20px 0; border-radius: 8px;">
<h4 class="dark-text" style="margin: 0 0 16px 0; font-size: 18px; font-weight: 600; color: #FFFFFF; line-height: 1.4;">${headline}</h4>
<ul style="margin: 16px 0 20px 0; padding-left: 0; margin-left: 0; list-style: none;">
  <li class="dark-text-secondary" style="margin: 0 0 16px 0; padding: 0; margin-left: 0; font-size: 16px; line-height: 1.6; color: #CCDADC;"><span style="color: #FDD458; font-weight: bold; font-size: 20px; margin-right: 8px;">•</span><strong style="color: #FDD458;">${symbol}</strong> is in focus from <strong style="color: #CCDADC;">${source}</strong>.</li>
  <li class="dark-text-secondary" style="margin: 0 0 16px 0; padding: 0; margin-left: 0; font-size: 16px; line-height: 1.6; color: #CCDADC;"><span style="color: #FDD458; font-weight: bold; font-size: 20px; margin-right: 8px;">•</span>${safeSummary}</li>
  <li class="dark-text-secondary" style="margin: 0 0 16px 0; padding: 0; margin-left: 0; font-size: 16px; line-height: 1.6; color: #CCDADC;"><span style="color: #FDD458; font-weight: bold; font-size: 20px; margin-right: 8px;">•</span>${dateHint}</li>
</ul>
<div style="background-color: #141414; border: 1px solid #374151; padding: 15px; border-radius: 6px; margin: 16px 0;">
<p class="dark-text-secondary" style="margin: 0; font-size: 14px; color: #CCDADC; line-height: 1.4;">💡 <strong style="color: #FDD458;">Bottom Line:</strong> This headline can influence short-term movement in your watchlist, so review the full story before making any trade decisions.</p>
</div>
<div style="margin: 20px 0 0 0;">
<a href="${url}" style="color: #FDD458; text-decoration: none; font-weight: 500; font-size: 14px;" target="_blank" rel="noopener noreferrer">Read Full Story →</a>
</div>
</div>`;
  });

  return `<h3 class="mobile-news-title dark-text" style="margin: 30px 0 15px 0; font-size: 18px; font-weight: 600; color: #f8f9fa; line-height: 1.3;">📊 Watchlist News</h3>
${cards.join("\n<div style=\"border-top: 1px solid #374151; margin: 32px 0 24px 0;\"></div>\n")}`;
}

function ensureSafeNewsHtml(raw: string, articles: MarketNewsArticle[]): string {
  const cleaned = sanitizeModelOutput(raw);

  if (!cleaned || hasReasoningLeak(raw) || hasReasoningLeak(cleaned)) {
    return buildFallbackNewsHtml(articles);
  }

  if (!looksLikeStructuredNewsHtml(cleaned)) {
    return buildFallbackNewsHtml(articles);
  }

  return cleaned;
}

function ensureSafeWelcomeIntro(raw: string, fallbackIntro: string): string {
  const cleaned = sanitizeModelOutput(raw);

  if (!cleaned || hasReasoningLeak(raw) || hasReasoningLeak(cleaned)) {
    return fallbackIntro;
  }

  const paragraphMatch = cleaned.match(/<p[^>]*>[\s\S]*?<\/p>/i);
  if (paragraphMatch?.[0]) {
    return paragraphMatch[0];
  }

  const plain = safeTrim(cleaned.replace(/<[^>]+>/g, "").trim(), 220);
  if (!plain) return fallbackIntro;

  return `<p class="mobile-text" style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #CCDADC;">${escapeHtml(plain)}</p>`;
}

function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<h3[^>]*>(.*?)<\/h3>/g, "\n📊 *$1*\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/g, "\n🔹 *$1*\n")
    .replace(/<li[^>]*>(.*?)<\/li>/g, "• $1\n")
    .replace(
      /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi,
      (_match, href, text) => `${text} ${href}`
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function safeTrim(text: string, limit = 1500): string {
  if (text.length <= limit) return text;
  const cutoff = text.lastIndexOf(".", limit);
  return cutoff > 0 ? text.substring(0, cutoff + 1) : text.slice(0, limit);
}

function toPromptArticle(
  article: MarketNewsArticle,
  summaryLimit = 280
): PromptNewsArticle {
  return {
    symbol: article.symbol,
    datetime: article.datetime,
    headline: safeTrim(article.headline || "", 140),
    summary: safeTrim(article.summary || "", summaryLimit),
    source: article.source,
    url: article.url,
  };
}

function buildNewsSummaryPrompt(
  articles: MarketNewsArticle[],
  maxArticles = 6,
  summaryLimit = 280
): string {
  const compactArticles = articles
    .slice(0, maxArticles)
    .map((article) => toPromptArticle(article, summaryLimit));

  let payload = compactArticles;
  let payloadString = JSON.stringify(payload, null, 2);

  // Keep shrinking until prompt size fits a safe budget under Groq TPM limits.
  while (payloadString.length > NEWS_SUMMARY_INPUT_CHAR_BUDGET && payload.length > 1) {
    payload = payload.slice(0, -1);
    payloadString = JSON.stringify(payload, null, 2);
  }

  return NEWS_SUMMARY_EMAIL_PROMPT.replace("{{newsData}}", payloadString);
}

function isRequestTooLargeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Request too large") ||
    message.includes("rate_limit_exceeded") ||
    message.includes("tokens per minute")
  );
}

// Welcome Email
export const sendSignUpEmail = inngest.createFunction(
  { id: "sign-up-email" },
  { event: "app/user.created" },
  async ({ event, step }) => {
    const { country, investmentGoals, riskTolerance, preferredIndustry, email, name } = event.data;

    const fallbackIntro = `<p class="mobile-text" style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #CCDADC;">Thanks for joining StockPulse. Based on your <strong>${escapeHtml(
      investmentGoals || "investment goals"
    )}</strong> and interest in <strong>${escapeHtml(
      preferredIndustry || "your preferred sector"
    )}</strong>, we will send focused insights matched to your <strong>${escapeHtml(
      riskTolerance || "risk profile"
    )}</strong>.</p>`;

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
        model: "qwen/qwen3-32b",
        messages: [
          {
            role: "system",
            content:
              "Return only final HTML content. Never include thoughts, reasoning, analysis, prefaces, or markdown.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 400,
      });
      return ensureSafeWelcomeIntro(
        completion.choices[0]?.message?.content || "",
        fallbackIntro
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
  [{ event: "app/send.daily.news" }, { cron: "30 2 * * 1-5"  }], // 8:00 AM IST (Runs Monday to Friday)
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
          const prompt = buildNewsSummaryPrompt(articles, 6, 280);

          let htmlSummary = await groq.chat.completions
            .create({
              model: "qwen/qwen3-32b",
              messages: [
                {
                  role: "system",
                  content:
                    "Return only final HTML fragment content. Never include thoughts, reasoning, analysis, markdown, or code fences.",
                },
                { role: "user", content: prompt },
              ],
              temperature: 0.3,
              max_tokens: NEWS_SUMMARY_MAX_OUTPUT_TOKENS,
            })
            .then((res) => res.choices[0]?.message?.content || "No market news.");

          htmlSummary = ensureSafeNewsHtml(htmlSummary, articles);

          const plainSummary = htmlToPlainText(htmlSummary);
          summaries.push({ user, htmlSummary, plainSummary });
        } catch (e) {
          if (isRequestTooLargeError(e)) {
            try {
              // Retry with a smaller payload if Groq rejects the first request size.
              const fallbackPrompt = buildNewsSummaryPrompt(articles, 3, 140);
              const fallbackHtml = await groq.chat.completions
                .create({
                  model: "qwen/qwen3-32b",
                  messages: [
                    {
                      role: "system",
                      content:
                        "Return only final HTML fragment content. Never include thoughts, reasoning, analysis, markdown, or code fences.",
                    },
                    { role: "user", content: fallbackPrompt },
                  ],
                  temperature: 0.3,
                  max_tokens: 700,
                })
                .then((res) => res.choices[0]?.message?.content || "No market news.");

              const safeFallbackHtml = ensureSafeNewsHtml(fallbackHtml, articles);

              const fallbackPlain = htmlToPlainText(safeFallbackHtml);
              summaries.push({
                user,
                htmlSummary: safeFallbackHtml,
                plainSummary: fallbackPlain,
              });
              continue;
            } catch (fallbackError) {
              console.error(
                "⚠️ Fallback summarization also failed for:",
                user.email,
                fallbackError
              );
            }
          }

          console.error("⚠️ Failed to summarize news for:", user.email, e);
          const safeHtml = buildFallbackNewsHtml(articles);
          summaries.push({
            user,
            htmlSummary: safeHtml,
            plainSummary: htmlToPlainText(safeHtml),
          });
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
      const summaryByPhone = new Map<string, string>();

      for (const { user, plainSummary } of userNewsSummaries) {
        if (!plainSummary) continue;
        const phone = (user.phone || process.env.TEST_PHONE_NUMBER || "").trim();
        if (!phone) continue;

        // Keep only one message per destination phone to avoid duplicate sends,
        // especially when multiple users fall back to the same test number.
        if (!summaryByPhone.has(phone)) {
          summaryByPhone.set(phone, safeTrim(plainSummary));
        }
      }

      await Promise.all(
        Array.from(summaryByPhone.entries()).map(async ([phone, summary]) => {
          await sendWhatsAppMessage(
            phone,
            `📈 *Daily Market Summary (${getFormattedTodayDate()})*\n\n${summary}`
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