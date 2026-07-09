import {
  IDataAgentClient,
  DataAgentQueryResult,
  ProgressUpdate,
} from "./dataAgentClient";
import { UserContext } from "../types";

const PROGRESS_STEPS = [
  "Understanding your question…",
  "Generating SQL…",
  "Querying the data warehouse…",
  "Formatting results…",
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Pure, synchronous mock response resolver. Shared by `MockDataAgentClient`
 * (REST-style) and the mock MCP server (tools/mockMcpServer.ts) so both surface
 * identical canned data.
 */
export function getMockDataAgentResponse(question: string): DataAgentQueryResult {
  const q = question.toLowerCase();

  if (q.includes("interactive")) return interactiveChartDemo();
  if (q.includes("revenue") && q.includes("region")) return revenueByRegion();
  if (q.includes("revenue") && q.includes("product")) return revenueByProduct();
  if (q.includes("trend") || q.includes("monthly") || q.includes("over time")) {
    return revenueTrend();
  }
  if (q.includes("revenue") || q.includes("sales")) return totalRevenue();
  if (q.includes("margin") || q.includes("profit")) return marginMetrics();
  if (q.includes("help") || q.includes("what can you")) return helpResponse();
  if (q.includes("graph test") || q.includes("chart test") || q.includes("demo graph")) {
    return graphDemo();
  }
  if (q.includes("history test") || q.includes("stateless test") || q.includes("context test")) {
    return historyTest(question);
  }

  return unknownQuery(question);
}

export class MockDataAgentClient implements IDataAgentClient {
  async query(
    question: string,
    _userContext?: UserContext,
    onProgress?: (update: ProgressUpdate) => void
  ): Promise<DataAgentQueryResult> {
    if (onProgress) {
      for (let i = 0; i < PROGRESS_STEPS.length; i++) {
        onProgress({
          message: PROGRESS_STEPS[i],
          progress: i + 1,
          total: PROGRESS_STEPS.length,
        });
        await delay(50);
      }
    } else {
      await delay(800);
    }

    return getMockDataAgentResponse(question);
  }

  async healthCheck(): Promise<{ status: string; latency: number }> {
    return { status: "healthy", latency: 1 };
  }
}

function revenueByRegion(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "table",
      title: "Revenue by Region (FY25 Q1)",
      sql: "SELECT region, SUM(revenue) as total_revenue FROM finance.revenue_data WHERE fiscal_year = 2025 AND fiscal_quarter = 1 GROUP BY region ORDER BY total_revenue DESC",
      columns: ["Region", "Revenue ($M)", "YoY Change"],
      rows: [
        ["North America", 12450, "+8.2%"],
        ["EMEA", 8930, "+5.1%"],
        ["APAC", 6780, "+12.4%"],
        ["LATAM", 2340, "+3.7%"],
      ],
    },
  };
}

function revenueByProduct(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "table",
      title: "Revenue by Product Line (FY25 Q1)",
      sql: "SELECT product_line, SUM(revenue) as total_revenue, COUNT(DISTINCT customer_id) as customers FROM finance.revenue_data WHERE fiscal_year = 2025 AND fiscal_quarter = 1 GROUP BY product_line ORDER BY total_revenue DESC",
      columns: ["Product Line", "Revenue ($M)", "Customers"],
      rows: [
        ["Cloud Services", 15200, 3420],
        ["Enterprise Software", 8100, 1850],
        ["Professional Services", 4300, 920],
        ["Hardware", 2900, 640],
      ],
    },
  };
}

function totalRevenue(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "metrics",
      title: "Total Revenue Summary (FY25 Q1)",
      sql: "SELECT SUM(revenue) as total, SUM(revenue) / LAG(SUM(revenue)) OVER (ORDER BY fiscal_quarter) - 1 as yoy FROM finance.revenue_data WHERE fiscal_year = 2025 AND fiscal_quarter = 1",
      metrics: [
        { label: "Total Revenue", value: "$30.5B", change: "+7.8%" },
        { label: "Gross Margin", value: "68.4%", change: "+1.2pp" },
        { label: "Operating Income", value: "$12.1B", change: "+9.3%" },
        { label: "Active Customers", value: "6,830", change: "+11.5%" },
      ],
    },
  };
}

function marginMetrics(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "metrics",
      title: "Margin Analysis (FY25 Q1)",
      sql: "SELECT margin_type, margin_pct, yoy_change FROM finance.margin_summary WHERE fiscal_year = 2025 AND fiscal_quarter = 1",
      metrics: [
        { label: "Gross Margin", value: "68.4%", change: "+1.2pp" },
        { label: "Operating Margin", value: "39.7%", change: "+0.8pp" },
        { label: "Net Margin", value: "33.2%", change: "+0.5pp" },
        { label: "EBITDA Margin", value: "45.1%", change: "+1.0pp" },
      ],
    },
  };
}

function revenueTrend(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "timeseries",
      title: "Monthly Revenue Trend (Last 6 Months)",
      sql: "SELECT month, SUM(revenue) as revenue FROM finance.revenue_data WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH) GROUP BY month ORDER BY month",
      seriesLabels: ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"],
      series: [
        { label: "Revenue ($B)", values: [9.2, 9.5, 10.8, 9.8, 10.1, 10.6] },
        { label: "Target ($B)", values: [9.0, 9.3, 10.5, 9.5, 9.8, 10.2] },
      ],
      chartImageUrl:
        "https://quickchart.io/chart?c=%7Btype%3A'line'%2Cdata%3A%7Blabels%3A%5B'Oct'%2C'Nov'%2C'Dec'%2C'Jan'%2C'Feb'%2C'Mar'%5D%2Cdatasets%3A%5B%7Blabel%3A'Revenue'%2Cdata%3A%5B9.2%2C9.5%2C10.8%2C9.8%2C10.1%2C10.6%5D%2CborderColor%3A'blue'%7D%2C%7Blabel%3A'Target'%2Cdata%3A%5B9.0%2C9.3%2C10.5%2C9.5%2C9.8%2C10.2%5D%2CborderColor%3A'gray'%7D%5D%7D%7D",
      chartAltText: "Monthly Revenue vs Target (Oct–Mar, $B)",
    },
  };
}

function historyTest(question: string): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "metrics",
      title: "History Isolation Verification",
      metrics: [
        { label: "Your Query", value: `"${question}"` },
        { label: "Prior Turns Sent", value: "0" },
        { label: "History Policy", value: "none" },
        { label: "Context Window", value: "single-turn" },
      ],
    },
  };
}

function graphDemo(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "timeseries",
      title: "Chart Rendering Demo — Quarterly Revenue (FY25)",
      sql: "SELECT quarter, SUM(revenue) as revenue FROM finance.revenue_data WHERE fiscal_year = 2025 GROUP BY quarter ORDER BY quarter",
      seriesLabels: ["Q1", "Q2", "Q3", "Q4"],
      series: [
        { label: "Revenue ($B)", values: [30.5, 31.2, 32.8, 34.1] },
        { label: "Target ($B)", values: [29.5, 30.5, 31.8, 33.0] },
      ],
      chartImageUrl:
        "https://quickchart.io/chart?c=%7Btype%3A'bar'%2Cdata%3A%7Blabels%3A%5B'Q1'%2C'Q2'%2C'Q3'%2C'Q4'%5D%2Cdatasets%3A%5B%7Blabel%3A'Revenue'%2Cdata%3A%5B30.5%2C31.2%2C32.8%2C34.1%5D%2CbackgroundColor%3A'rgba(0%2C112%2C192%2C0.8)'%7D%2C%7Blabel%3A'Target'%2Cdata%3A%5B29.5%2C30.5%2C31.8%2C33.0%5D%2CbackgroundColor%3A'rgba(128%2C128%2C128%2C0.5)'%7D%5D%7D%7D",
      chartAltText: "Quarterly Revenue vs Target FY25 ($B)",
    },
  };
}

function interactiveChartDemo(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "timeseries",
      title: "Interactive Chart Demo — Quarterly Revenue (FY25)",
      sql: "SELECT quarter, SUM(revenue) as revenue FROM finance.revenue_data WHERE fiscal_year = 2025 GROUP BY quarter ORDER BY quarter",
      seriesLabels: ["Q1", "Q2", "Q3", "Q4"],
      series: [
        { label: "Revenue ($B)", values: [30.5, 31.2, 32.8, 34.1] },
        { label: "Target ($B)", values: [29.5, 30.5, 31.8, 33.0] },
      ],
      // Illustrates a Data Agent that hosts its OWN interactive chart: the card
      // links straight to this URL instead of the bot-hosted /charts/:id page.
      // Replace with a real hosted chart URL in production.
      interactiveChartUrl: "https://example.com/interactive-charts/quarterly-revenue",
    },
  };
}

function helpResponse(): DataAgentQueryResult {
  return {
    success: true,
    data: {
      type: "metrics",
      title: "What I can help with",
      metrics: [
        { label: "Revenue Queries", value: '"What\'s total revenue by region?"' },
        { label: "Margin Analysis", value: '"Show me gross margin trends"' },
        { label: "Product Breakdown", value: '"Revenue by product line"' },
        { label: "Time Trends", value: '"Monthly revenue over time"' },
      ],
    },
  };
}

function unknownQuery(question: string): DataAgentQueryResult {
  return {
    success: false,
    error: `I couldn't find data matching: "${question}"`,
    suggestions: [
      "Total revenue by region",
      "Gross margin this quarter",
      "Monthly revenue trend",
      "Revenue by product line",
    ],
  };
}
