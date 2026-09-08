export function validSummary() {
  const evidence = [
    ["00:00", "you you you you", true],
    ["00:10", "Creators use AI privately", false],
    ["00:10", "avoid discussing it publicly", false],
    ["00:30", "compared two coding models", false],
    ["00:30", "preferred the second one's mergeable code", false],
  ];
  const highlights = evidence.map(([timestamp, excerpt, uncertain], index) => ({
    timestamp,
    title: `Grounded highlight ${index + 1}`,
    summary: "A concise grounded highlight.",
    excerpt,
    uncertain,
  }));
  return {
    topics: [
      {
        timestamp: "00:00",
        title: "Uncertain opening audio",
        summary: "The first segment contains only repeated words.",
        excerpt: "you you you you I I I I",
        uncertain: true,
      },
      { timestamp: "00:10", title: "Private AI use", summary: "He discussed creators keeping AI use private.", excerpt: "Creators use AI privately", uncertain: false },
      { timestamp: "00:30", title: "Coding-model comparison", summary: "He compared coding models on mergeability.", excerpt: "preferred the second one's mergeable code", uncertain: false },
    ],
    highlights,
    claims: [{ timestamp: "00:10", claim: "Some creators use AI privately while avoiding public discussion.", excerpt: "Creators use AI privately but avoid discussing it publicly.", uncertain: false }],
  };
}

