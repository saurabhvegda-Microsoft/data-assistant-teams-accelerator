import { CardFactory } from "@microsoft/agents-hosting";

export function buildErrorCard(
  errorMessage: string,
  suggestions?: string[]
) {
  const body: any[] = [
    {
      type: "TextBlock",
      text: "Something went wrong",
      weight: "Bolder",
      size: "Medium",
      color: "Attention",
    },
    {
      type: "TextBlock",
      text: errorMessage,
      wrap: true,
      spacing: "Small",
    },
  ];

  if (suggestions && suggestions.length > 0) {
    body.push({
      type: "TextBlock",
      text: "Try one of these instead:",
      weight: "Bolder",
      size: "Small",
      spacing: "Medium",
    });

    for (const suggestion of suggestions) {
      body.push({
        type: "TextBlock",
        text: `• ${suggestion}`,
        wrap: true,
        size: "Small",
        spacing: "None",
      });
    }
  }

  const card = {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body,
  };

  return CardFactory.adaptiveCard(card);
}
