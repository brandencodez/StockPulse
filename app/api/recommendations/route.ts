import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { getWatchlistSymbolsByEmail } from "@/lib/actions/watchlist.actions";

type Recommendation = { symbol: string; reason: string; risk: string };

function normalizeIndustry(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z-\/]/g, "");
}

function resolveIndustryKey(preferredIndustry: string): string {
  const normalized = normalizeIndustry(preferredIndustry);

  const directMap: Record<string, string> = {
    technology: "technology",
    healthcare: "healthcare",
    finance: "finance",
    energy: "energy",
    consumer: "consumer",
    "consumer-goods": "consumer",
    "real-estate": "real-estate",
    mixed: "mixed",
    "mixed/diversified": "mixed",
    diversified: "mixed"
  };

  if (directMap[normalized]) return directMap[normalized];

  // Fuzzy aliases for profile values that vary slightly.
  if (normalized.includes("tech")) return "technology";
  if (normalized.includes("health")) return "healthcare";
  if (normalized.includes("finan") || normalized.includes("bank")) return "finance";
  if (normalized.includes("energy") || normalized.includes("oil") || normalized.includes("utility")) return "energy";
  if (normalized.includes("consumer") || normalized.includes("retail")) return "consumer";
  if (normalized.includes("real") || normalized.includes("estate") || normalized.includes("reit")) return "real-estate";
  if (normalized.includes("mixed") || normalized.includes("divers")) return "mixed";

  return "mixed";
}

function buildFallbackRecommendations(
  relevantStocks: string[],
  watchlistSymbols: string[],
  riskTolerance: string,
  investmentGoals: string
): Recommendation[] {
  const watchlistSet = new Set((watchlistSymbols || []).map((s) => s.toUpperCase()));
  const selected = relevantStocks
    .filter((s) => !watchlistSet.has(s.toUpperCase()))
    .slice(0, 5);

  const goal = String(investmentGoals || "balanced").toLowerCase();
  const reasonByGoal: Record<string, string> = {
    growth: "Strong growth profile in its sector",
    income: "Reliable cash flow with income potential",
    balanced: "Balances stability and upside potential",
    preservation: "Defensive profile with lower volatility"
  };

  const defaultReason = reasonByGoal[goal] || reasonByGoal.balanced;

  return selected.map((symbol) => ({
    symbol,
    reason: defaultReason,
    risk: String(riskTolerance || "moderate")
  }));
}

export async function GET(req: NextRequest) {
  try {
    const { api } = await auth();
    const session = await api.getSession({ headers: await headers() });
    const user = session?.user;

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { riskTolerance, preferredIndustry, investmentGoals } = user as any;
    
    if (!riskTolerance || !preferredIndustry || !investmentGoals) {
      return NextResponse.json({ 
        recommendations: []
      }, { status: 200 });
    }

    const watchlistSymbols = await getWatchlistSymbolsByEmail(user.email);
    const hasWatchlist = watchlistSymbols && watchlistSymbols.length > 0;

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      console.error("GROQ_API_KEY not found");
      return NextResponse.json({ 
        error: "API configuration error",
        recommendations: []
      }, { status: 500 });
    }

    const currentDate = new Date().toISOString().split('T')[0];

    const stockUniverses: Record<string, string[]> = {
      technology: [
        'AAPL', 'MSFT', 'GOOGL', 'META', 'NVDA', 'AMD', 'INTC', 'ORCL', 
        'CRM', 'ADBE', 'SNOW', 'PLTR', 'NET', 'CRWD', 'ZS', 'DDOG',
        'SHOP', 'SQ', 'PYPL', 'COIN', 'RBLX', 'U', 'TEAM', 'OKTA',
        'NOW', 'WDAY', 'ZM', 'DOCU', 'TWLO', 'MDB', 'ESTC'
      ],
      healthcare: [
        'JNJ', 'UNH', 'PFE', 'ABBV', 'TMO', 'ABT', 'DHR', 'LLY',
        'MRK', 'BMY', 'AMGN', 'GILD', 'CVS', 'CI', 'HUM', 'ISRG',
        'VRTX', 'REGN', 'BIIB', 'ZTS', 'ILMN', 'DXCM', 'ALGN',
        'TDOC', 'VEEV', 'IQV', 'EW', 'HOLX'
      ],
      finance: [
        'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'V', 'MA', 'AXP',
        'SCHW', 'BLK', 'SPGI', 'CME', 'ICE', 'CB', 'PGR', 'TRV',
        'AIG', 'MET', 'PRU', 'AFL', 'ALL', 'TROW', 'BK', 'STT',
        'USB', 'PNC', 'TFC', 'COF', 'DFS'
      ],
      energy: [
        'XOM', 'CVX', 'COP', 'EOG', 'PXD', 
        'SLB', 'HAL', 'BKR',
        'MPC', 'PSX', 'VLO',
        'OXY', 'DVN', 'FANG', 'HES', 'MRO', 'APA', 'CTRA', 'OVV',
        'NEE', 'DUK', 'SO', 'D', 'AEP', 'XEL', 'SRE', 'ES', 'AWK', 'ED'
      ],
      consumer: [
        'PG', 'KO', 'PEP', 'CL', 'KMB', 'GIS', 'K', 'CAG', 'HSY', 'MDLZ',
        'WMT', 'COST', 'HD', 'LOW', 'TGT',
        'NKE', 'SBUX', 'MCD', 'DIS', 'NFLX',
        'CMCSA', 'VZ', 'T',
        'PM', 'MO', 'EL', 'CLX', 'CHD', 'SJM', 'CPB'
      ],
      'real-estate': [
        'PLD', 'DLR', 'EQIX',
        'AMT', 'CCI', 'SBAC',
        'PSA', 'EXR', 'CUBE',
        'WELL', 'AVB', 'EQR', 'MAA', 'ESS', 'UDR', 'CPT', 'INVH',
        'O', 'SPG', 'KIM', 'REG',
        'VICI', 'VTR', 'ARE', 'BXP', 'HST', 'SLG', 'VNO', 'AIV',
        'WY', 'PCH'
      ],
      mixed: [
        // Best of each sector
        'AAPL', 'MSFT', 'NVDA', 'GOOGL', // Tech
        'JNJ', 'UNH', 'LLY', 'ABBV', // Healthcare
        'JPM', 'V', 'MA', 'BAC', // Finance
        'XOM', 'CVX', 'NEE', 'COP', // Energy
        'PG', 'WMT', 'COST', 'KO', 'HD', // Consumer
        'PLD', 'AMT', 'EQIX', 'O' // Real Estate
      ]
    };

    // Resolve preferred industry robustly to avoid accidental fallback to mixed.
    const industryKey = resolveIndustryKey(preferredIndustry);
    const relevantStocks = stockUniverses[industryKey] || stockUniverses.mixed;

    // Industry descriptions for better AI context
    const industryDescriptions: Record<string, string> = {
      'technology': 'software, cloud computing, semiconductors, AI, cybersecurity, and digital platforms',
      'healthcare': 'pharmaceuticals, biotech, medical devices, health insurance, and healthcare services',
      'finance': 'banks, investment firms, payment processors, insurance companies, and financial services',
      'energy': 'oil & gas exploration/production (XOM, CVX, COP), oilfield services (SLB, HAL), refiners (MPC, PSX), and utilities (NEE, DUK)',
      'consumer': 'retail stores (WMT, COST, HD), consumer products (PG, KO, PEP), restaurants (MCD, SBUX), entertainment (DIS, NFLX), and telecom (VZ, T)',
      'real-estate': 'REITs including industrial warehouses (PLD), data centers (DLR, EQIX), cell towers (AMT, CCI), apartments (AVB, EQR), retail properties (O, SPG), and storage facilities (PSA)',
      'mixed': 'diversified portfolio across technology, healthcare, finance, energy, consumer goods, and real estate sectors'
    };

    // Provide specific examples for each sector
    const sectorExamples: Record<string, string> = {
      'technology': 'Examples: AAPL (consumer tech), MSFT (enterprise software), NVDA (AI chips), GOOGL (search/cloud)',
      'healthcare': 'Examples: JNJ (pharma/devices), UNH (health insurance), LLY (biotech), ABBV (pharmaceuticals)',
      'finance': 'Examples: JPM (banking), V/MA (payments), BLK (asset management), CB (insurance)',
      'energy': 'Examples: XOM/CVX (oil majors), SLB (services), MPC/PSX (refiners), NEE (renewable utilities)',
      'consumer': 'Examples: PG (household goods), WMT/COST (retail), KO/PEP (beverages), MCD (restaurants), DIS (entertainment)',
      'real-estate': 'Examples: PLD (warehouses), AMT (cell towers), EQIX (data centers), O (retail), PSA (storage), AVB (apartments)',
      'mixed': 'Select from multiple sectors for diversification'
    };

    let watchlistContext = '';
    let exclusionNote = '';
    let diversificationNote = '';
    
    if (hasWatchlist) {
      watchlistContext = `\n\nUser's Current Watchlist:\n${watchlistSymbols.join(', ')}`;
      exclusionNote = `\n4. CRITICAL: DO NOT recommend ANY stocks already in the user's watchlist (${watchlistSymbols.join(', ')}). Only recommend NEW stocks.`;
      
      const sectorCounts = new Map<string, number>();
      watchlistSymbols.forEach(symbol => {
        for (const [sector, stocks] of Object.entries(stockUniverses)) {
          if (stocks.includes(symbol)) {
            sectorCounts.set(sector, (sectorCounts.get(sector) || 0) + 1);
          }
        }
      });
      
      const dominantSectors = Array.from(sectorCounts.entries())
        .filter(([_, count]) => count >= 3)
        .map(([sector]) => sector);
      
      if (dominantSectors.length > 0) {
        diversificationNote = `\n5. The user already has heavy exposure to: ${dominantSectors.join(', ')}. Consider diversification if recommending for 'mixed' portfolio.`;
      }
    }

    const riskGuidance: Record<string, string> = {
      conservative: 'Focus on stable, dividend-paying blue-chip companies with proven track records and low volatility',
      moderate: 'Balance between growth potential and stability, including established companies with growth prospects',
      aggressive: 'Prioritize high-growth potential stocks, including emerging leaders and innovative companies, accepting higher volatility'
    };

    const investmentGoalsGuidance: Record<string, string> = {
      growth: 'Prioritize stocks with strong capital appreciation potential and revenue growth, even if dividends are minimal',
      income: 'Focus on dividend-paying stocks with consistent cash flow and reliable income generation',
      balanced: 'Mix of growth stocks and dividend payers, balancing capital appreciation with income generation',
      preservation: 'Emphasize capital preservation with stable, low-volatility blue-chip stocks and defensive sectors'
    };

    const prompt = `You are an expert stock advisor AI. Today is ${currentDate}.

User Profile:
- Risk Tolerance: ${riskTolerance}
- Investment Goals: ${investmentGoals}
- Preferred Industry: ${preferredIndustry}${watchlistContext}

STOCK UNIVERSE - YOU MUST ONLY CHOOSE FROM THESE EXACT TICKERS:
${relevantStocks.join(', ')}

${sectorExamples[industryKey]}

What ${preferredIndustry} means: ${industryDescriptions[industryKey]}

Investment Strategy for ${investmentGoals}:
${investmentGoalsGuidance[investmentGoals.toLowerCase()] || investmentGoalsGuidance.balanced}

Risk Approach for ${riskTolerance}:
${riskGuidance[riskTolerance.toLowerCase()] || riskGuidance.moderate}

YOUR TASK:
Select exactly 5 stocks from the stock universe above that:
1. Are ALL from ${preferredIndustry} sector (${industryDescriptions[industryKey]})
2. Match ${investmentGoals} goals: ${investmentGoalsGuidance[investmentGoals.toLowerCase()] || investmentGoalsGuidance.balanced}
3. Match ${riskTolerance} risk tolerance
4. Are NOT in the user's watchlist${exclusionNote ? ': ' + watchlistSymbols.join(', ') : ''}${diversificationNote}

STRICT RULES:
✓ Use ONLY tickers listed in the stock universe above
✓ All 5 stocks MUST be from ${preferredIndustry} sector
✓ DO NOT recommend stocks from the watchlist
✓ Match the exact risk level: ${riskTolerance}
✗ DO NOT invent tickers not in the list
✗ DO NOT mix sectors (stay in ${preferredIndustry})

Output format (JSON only, no markdown, no explanations):
[
  { "symbol": "TICKER", "reason": "Brief reason (max 15 words)", "risk": "${riskTolerance}" }
]`;

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqApiKey}`
        },
        body: JSON.stringify({
          model: 'qwen/qwen3-32b',
          messages: [
            { 
              role: 'system', 
              content: `You are a stock recommendation AI. You MUST only recommend stocks from the provided list. Always return valid JSON arrays with no extra text.` 
            },
            { 
              role: 'user', 
              content: prompt 
            }
          ],
          temperature: 0.4,
          max_tokens: 1000,
          top_p: 0.8
        })
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Groq API Error:", errorText);
      return NextResponse.json({ 
        error: "Failed to generate recommendations",
        recommendations: buildFallbackRecommendations(
          relevantStocks,
          watchlistSymbols,
          riskTolerance,
          investmentGoals
        )
      }, { status: 500 });
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content;

    if (!aiResponse) {
      return NextResponse.json({ 
        error: "No response from AI",
        recommendations: buildFallbackRecommendations(
          relevantStocks,
          watchlistSymbols,
          riskTolerance,
          investmentGoals
        )
      }, { status: 500 });
    }

    let parsedRecommendations: Recommendation[] = [];

    try {
      let cleanedResponse = aiResponse.trim();

      // Remove complete and unterminated think blocks.
      cleanedResponse = cleanedResponse.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
      cleanedResponse = cleanedResponse.replace(/<think>[\s\S]*$/gi, '').trim();

      // Remove markdown code fences
      cleanedResponse = cleanedResponse.replace(/```json\s*/gi, '');
      cleanedResponse = cleanedResponse.replace(/```\s*/g, '');

      // First try strict JSON array extraction.
      const start = cleanedResponse.indexOf('[');
      const end = cleanedResponse.lastIndexOf(']');

      if (start !== -1 && end !== -1 && end > start) {
        const jsonStr = cleanedResponse.slice(start, end + 1);
        parsedRecommendations = JSON.parse(jsonStr);
      } else {
        // Fallback: support object-style payloads like { recommendations: [...] }.
        const objStart = cleanedResponse.indexOf('{');
        const objEnd = cleanedResponse.lastIndexOf('}');
        if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
          const objStr = cleanedResponse.slice(objStart, objEnd + 1);
          const parsedObj = JSON.parse(objStr);
          parsedRecommendations = parsedObj?.recommendations || parsedObj?.data || [];
        }
      }

      if (!Array.isArray(parsedRecommendations)) {
        throw new Error("Parsed response is not an array");
      }

      // Validate that recommended stocks are from the correct universe
      const validSymbols = new Set(relevantStocks.map(s => s.toUpperCase()));
      parsedRecommendations = parsedRecommendations.filter(rec => 
        rec?.symbol && validSymbols.has(rec.symbol.toUpperCase())
      );

      // Filter out watchlist duplicates
      if (hasWatchlist) {
        const watchlistSet = new Set(watchlistSymbols.map(s => s.toUpperCase()));
        parsedRecommendations = parsedRecommendations.filter(rec => 
          !watchlistSet.has(rec.symbol.toUpperCase())
        );
      }

      parsedRecommendations = parsedRecommendations
        .filter(rec => rec.symbol && rec.reason && rec.risk)
        .slice(0, 5);

      // Top up to always return up to 5 items when AI output is partial after filtering.
      if (parsedRecommendations.length < 5) {
        const existing = new Set(parsedRecommendations.map((r) => r.symbol.toUpperCase()));
        const fallbackPool = buildFallbackRecommendations(
          relevantStocks,
          watchlistSymbols,
          riskTolerance,
          investmentGoals
        ).filter((r) => !existing.has(r.symbol.toUpperCase()));

        parsedRecommendations = [...parsedRecommendations, ...fallbackPool].slice(0, 5);
      }

    } catch (e) {
      console.error("Failed to parse AI response:", aiResponse);
      console.error("Parse error:", e);
      
      parsedRecommendations = buildFallbackRecommendations(
        relevantStocks,
        watchlistSymbols,
        riskTolerance,
        investmentGoals
      );
    }

    return NextResponse.json({ 
      recommendations: parsedRecommendations,
      generatedAt: currentDate,
      watchlistCount: watchlistSymbols?.length || 0,
      basedOn: { riskTolerance, investmentGoals, preferredIndustry, hasWatchlist },
      refreshNote: hasWatchlist 
        ? "Recommendations update dynamically as you modify your watchlist" 
        : "Add stocks to your watchlist for more personalized recommendations"
    });

  } catch (error: any) {
    console.error("❌ Error fetching recommendations:", error);
    return NextResponse.json({ 
      error: error.message || "Failed to fetch recommendations",
      recommendations: []
    }, { status: 500 });
  }
}