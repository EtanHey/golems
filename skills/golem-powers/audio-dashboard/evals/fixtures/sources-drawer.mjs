// Synthetic UI fixture only: no live narration or private research content.
export const promptText = '  Compare "Option A" & <Option B>.\r\nKeep {{SCRIPT}} literal.\n\tEnd with a recommendation.  ';
export const sourcesCard = {
  id: 'research', title: 'Choose the research path', sceneIds: ['s1'],
  body: 'Read the sources or copy a research prompt before choosing.', options: ['Proceed', 'Revisit'],
  sources: [{ label: 'Research overview', url: 'https://example.com/research?a=1&b=2' },
    { label: 'Supporting comparison', url: './visuals/comparison.html' }],
  copyPrompt: { label: 'Copy research prompt', text: promptText,
    notes: 'Turn on Google Docs in Gemini.\nResearch lifecycle run: yes (synthetic fixture).' },
};
export const sourcesSpec = {
  id: 'sources-synthetic', title: 'Research briefing', heading: 'Research briefing',
  redesign: { reason: 'Add the requested per-card Sources drawer and research prompt copy control.',
    approvedBy: 'Etan via orc 2026-11-08 (sources drawer request)', invariants: ['COPY_BUTTONS'],
    from: 'c92515f5d71f465fe8c81e9be2d97adfaef646c614aa6247df1af420b3dfaff7' },
  scenes: [{ id: 's1', title: 'The decision', script: 'Choose the research path.', duration: 1,
    audioUrl: 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=',
    words: [{ word: 'Choose', start: 0, end: 0.4 }, { word: 'carefully.', start: 0.5, end: 0.9 }] }],
  decisions: [sourcesCard],
};
