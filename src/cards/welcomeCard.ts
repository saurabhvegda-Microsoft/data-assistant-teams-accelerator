import { CardFactory } from "@microsoft/agents-hosting";

export function buildWelcomeCard() {
  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [
      {
        type: "TextBlock",
        text: "Welcome to Data Assistant",
        weight: "Bolder",
        size: "Large",
      },
      {
        type: "TextBlock",
        text: "I'm your financial data assistant. Ask me questions about revenue, margins, trends, and more — I'll query the data and show you results right here in Teams.",
        wrap: true,
        spacing: "Small",
      },
      {
        type: "TextBlock",
        text: "Try asking:",
        weight: "Bolder",
        size: "Small",
        spacing: "Medium",
      },
      {
        type: "TextBlock",
        text: "• \"What's total revenue this quarter?\"\n• \"Show me revenue by region\"\n• \"Gross margin trends over time\"\n• \"Revenue by product line\"",
        wrap: true,
        size: "Small",
        spacing: "None",
      },
    ],
  };

  return CardFactory.adaptiveCard(card);
}
