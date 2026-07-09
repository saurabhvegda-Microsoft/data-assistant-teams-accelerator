import express from "express";

const app = express();
app.use(express.json());

app.post("/api/query", (req, res) => {
  const { question } = req.body;
  if (!question) {
    res.status(400).json({ success: false, error: "Missing 'question' field" });
    return;
  }

  const q = question.toLowerCase();

  // Simulate latency (1–3s)
  const delay = 1000 + Math.random() * 2000;
  setTimeout(() => {
    if (q.includes("graph test") || q.includes("chart test") || q.includes("demo graph")) {
      res.json({
        success: true,
        data: {
          type: "timeseries",
          title: "Graph Validation Scenario: Revenue vs Target",
          sql: "SELECT month, revenue, target FROM finance.revenue_trend_validation ORDER BY month",
          seriesLabels: ["Oct", "Nov", "Dec", "Jan", "Feb", "Mar"],
          series: [
            { label: "Revenue ($B)", values: [9.2, 9.5, 10.8, 9.8, 10.1, 10.6] },
            { label: "Target ($B)", values: [9.0, 9.3, 10.5, 9.5, 9.8, 10.2] },
          ],
          chartImageUrl: "https://quickchart.io/chart?width=720&height=360&c={type:'line',data:{labels:['Oct','Nov','Dec','Jan','Feb','Mar'],datasets:[{label:'Revenue%20($B)',borderColor:'rgb(16,185,129)',backgroundColor:'rgba(16,185,129,0.2)',fill:false,data:[9.2,9.5,10.8,9.8,10.1,10.6]},{label:'Target%20($B)',borderColor:'rgb(59,130,246)',backgroundColor:'rgba(59,130,246,0.2)',fill:false,data:[9.0,9.3,10.5,9.5,9.8,10.2]}]},options:{plugins:{legend:{position:'bottom'}},scales:{y:{title:{display:true,text:'Billions%20USD'}}}}}",
          chartAltText: "Line chart showing revenue versus target across six months",
        },
      });
    } else if (q.includes("revenue") && q.includes("region")) {
      res.json({
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
      });
    } else if (q.includes("revenue") && q.includes("product")) {
      res.json({
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
      });
    } else if (q.includes("trend") || q.includes("monthly") || q.includes("over time")) {
      res.json({
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
        },
      });
    } else if (q.includes("revenue") || q.includes("sales")) {
      res.json({
        success: true,
        data: {
          type: "metrics",
          title: "Total Revenue Summary (FY25 Q1)",
          sql: "SELECT SUM(revenue) as total FROM finance.revenue_data WHERE fiscal_year = 2025 AND fiscal_quarter = 1",
          metrics: [
            { label: "Total Revenue", value: "$30.5B", change: "+7.8%" },
            { label: "Gross Margin", value: "68.4%", change: "+1.2pp" },
            { label: "Operating Income", value: "$12.1B", change: "+9.3%" },
            { label: "Active Customers", value: "6,830", change: "+11.5%" },
          ],
        },
      });
    } else if (q.includes("margin") || q.includes("profit")) {
      res.json({
        success: true,
        data: {
          type: "metrics",
          title: "Margin Analysis (FY25 Q1)",
          sql: "SELECT margin_type, margin_pct FROM finance.margin_summary WHERE fiscal_year = 2025 AND fiscal_quarter = 1",
          metrics: [
            { label: "Gross Margin", value: "68.4%", change: "+1.2pp" },
            { label: "Operating Margin", value: "39.7%", change: "+0.8pp" },
            { label: "Net Margin", value: "33.2%", change: "+0.5pp" },
            { label: "EBITDA Margin", value: "45.1%", change: "+1.0pp" },
          ],
        },
      });
    } else if (q.includes("help") || q.includes("what can you")) {
      res.json({
        success: true,
        data: {
          type: "metrics",
          title: "What I can help with",
          metrics: [
            { label: "Revenue Queries", value: "\"What's total revenue by region?\"" },
            { label: "Margin Analysis", value: "\"Show me gross margin trends\"" },
            { label: "Product Breakdown", value: "\"Revenue by product line\"" },
            { label: "Time Trends", value: "\"Monthly revenue over time\"" },
          ],
        },
      });
    } else {
      res.json({
        success: false,
        error: `I couldn't find data matching: "${question}"`,
        suggestions: [
          "Total revenue by region",
          "Gross margin this quarter",
          "Monthly revenue trend",
          "Revenue by product line",
        ],
      });
    }
  }, delay);
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "data-agent-mock-api", timestamp: new Date().toISOString() });
});

const port = process.env.MOCK_API_PORT || 4000;
app.listen(port, () => {
  console.log(`Mock Data Assistant API running at http://localhost:${port}`);
  console.log(`POST http://localhost:${port}/api/query  { "question": "..." }`);
});
